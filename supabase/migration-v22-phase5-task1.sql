-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v22 Phase 5 Task 1
-- Multi-Scan & Re-entry: scan_ticket RPC
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates new function. Idempotent.
--
-- BRD Section 11:
--   "الماسح يدعم عدد مسح محدد أو غير محدود لكل تذكرة"
--   "يجب تسجيل كل محاولة مسح في جدول scans"
--   "يجب أن يظهر عدد المسحات المتبقية"
--
-- Concurrency: FOR UPDATE row lock on ticket prevents
-- race conditions from rapid double-scanning.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: scan_ticket() RPC ════════════
--
-- Input: ticket_id, scanned_by (user_id), device_info, ip_address
-- Output: JSONB with scan result, remaining scans, ticket details
--
-- Logic:
--   1. Lock ticket row (FOR UPDATE) — prevents concurrent scans
--   2. Check ticket status (valid/used/cancelled/revoked)
--   3. Compare scan_count vs max_scans_allowed
--      - NULL or 0 max_scans_allowed = UNLIMITED
--   4. Determine scan_result: 'admitted' (first), 're_entry', 'rejected'
--   5. Insert into scans table
--   6. Update ticket.scan_count (and status if max reached)
--   7. Return full scan context for scanner UI

DROP FUNCTION IF EXISTS scan_ticket(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION scan_ticket(
  p_ticket_id   UUID,
  p_scanned_by  UUID,
  p_device_info TEXT DEFAULT '',
  p_ip_address  TEXT DEFAULT ''
)
RETURNS JSONB AS $func$
DECLARE
  v_ticket       RECORD;
  v_tier         RECORD;
  v_event        RECORD;
  v_scan_result  TEXT;
  v_scan_id      UUID;
  v_is_unlimited BOOLEAN;
  v_scans_left   INT;
  v_new_count    INT;
  v_new_status   TEXT;
  v_buyer_name   TEXT;
  v_cooldown_ms  INT := 3000; -- 3 second cooldown between scans
  v_last_scan    TIMESTAMPTZ;
BEGIN
  -- ═══ 1. Lock ticket row (prevents concurrent scans) ═══
  SELECT t.*
  INTO v_ticket
  FROM tickets t
  WHERE t.id = p_ticket_id
  FOR UPDATE;  -- Blocks concurrent scans on same ticket

  IF v_ticket IS NULL THEN
    -- Still log the failed attempt
    INSERT INTO scans (ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes)
    VALUES (p_ticket_id, NULL, p_scanned_by, 'rejected', p_device_info, p_ip_address, 'Ticket not found');

    RETURN jsonb_build_object(
      'valid', false,
      'scan_result', 'rejected',
      'message', 'Ticket not found',
      'ticket_id', p_ticket_id
    );
  END IF;

  -- ═══ 2. Check ticket status ═══
  IF v_ticket.status IN ('cancelled', 'revoked', 'refunded') THEN
    INSERT INTO scans (ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes)
    VALUES (p_ticket_id, v_ticket.ticket_tier_id, p_scanned_by, 'rejected', p_device_info, p_ip_address,
            'Ticket status: ' || v_ticket.status);

    RETURN jsonb_build_object(
      'valid', false,
      'scan_result', 'rejected',
      'message', 'Ticket is ' || v_ticket.status,
      'ticket_id', p_ticket_id,
      'status', v_ticket.status
    );
  END IF;

  -- ═══ 3. Anti-rapid-scan cooldown ═══
  -- Prevent accidental double-scans within 3 seconds
  SELECT MAX(s.scanned_at) INTO v_last_scan
  FROM scans s
  WHERE s.ticket_id = p_ticket_id
    AND s.scan_result IN ('admitted', 're_entry');

  IF v_last_scan IS NOT NULL AND
     (extract(epoch from (now() - v_last_scan)) * 1000) < v_cooldown_ms THEN
    RETURN jsonb_build_object(
      'valid', true,
      'scan_result', 'duplicate',
      'message', 'Already scanned (cooldown active)',
      'ticket_id', p_ticket_id,
      'cooldown_remaining_ms', v_cooldown_ms - (extract(epoch from (now() - v_last_scan)) * 1000)::INT
    );
  END IF;

  -- ═══ 4. Fetch tier + event for context ═══
  SELECT tt.name, tt.price, tt.max_scans, tt.event_id
  INTO v_tier
  FROM ticket_tiers tt
  WHERE tt.id = v_ticket.ticket_tier_id;

  SELECT e.title, e.venue, e.date
  INTO v_event
  FROM events e
  WHERE e.id = v_tier.event_id;

  -- ═══ 5. Determine scan limits ═══
  -- max_scans_allowed: NULL or 0 = unlimited
  v_is_unlimited := COALESCE(v_ticket.max_scans_allowed, 0) = 0;
  v_new_count := COALESCE(v_ticket.scan_count, 0) + 1;

  IF NOT v_is_unlimited AND v_ticket.scan_count >= v_ticket.max_scans_allowed THEN
    -- MAX SCANS REACHED — reject
    INSERT INTO scans (ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes)
    VALUES (p_ticket_id, v_tier.event_id, p_scanned_by, 'rejected', p_device_info, p_ip_address,
            'Max scans reached: ' || v_ticket.scan_count || '/' || v_ticket.max_scans_allowed);

    RETURN jsonb_build_object(
      'valid', false,
      'scan_result', 'rejected',
      'message', 'Maximum entries reached (' || v_ticket.max_scans_allowed || ')',
      'ticket_id', p_ticket_id,
      'scan_count', v_ticket.scan_count,
      'max_scans', v_ticket.max_scans_allowed,
      'is_unlimited', false
    );
  END IF;

  -- ═══ 6. Determine scan result type ═══
  IF COALESCE(v_ticket.scan_count, 0) = 0 THEN
    v_scan_result := 'admitted';   -- First entry ever
  ELSE
    v_scan_result := 're_entry';   -- Has been scanned before
  END IF;

  -- ═══ 7. Determine new ticket status ═══
  IF NOT v_is_unlimited AND v_new_count >= v_ticket.max_scans_allowed THEN
    v_new_status := 'used';       -- Max reached after this scan
  ELSE
    v_new_status := 'valid';      -- Still has remaining scans
  END IF;

  -- ═══ 8. Insert scan record ═══
  v_scan_id := gen_random_uuid();
  INSERT INTO scans (id, ticket_id, event_id, scanned_by, scan_result, device_info, ip_address)
  VALUES (v_scan_id, p_ticket_id, v_tier.event_id, p_scanned_by, v_scan_result, p_device_info, p_ip_address);

  -- ═══ 9. Update ticket ═══
  UPDATE tickets
  SET scan_count = v_new_count,
      status = v_new_status,
      scanned_at = COALESCE(scanned_at, now())  -- Preserve first scan timestamp
  WHERE id = p_ticket_id;

  -- ═══ 10. Calculate remaining scans ═══
  IF v_is_unlimited THEN
    v_scans_left := -1;  -- Sentinel for unlimited
  ELSE
    v_scans_left := v_ticket.max_scans_allowed - v_new_count;
  END IF;

  -- ═══ 11. Get buyer name for display ═══
  BEGIN
    IF v_ticket.user_id IS NOT NULL THEN
      SELECT p.full_name INTO v_buyer_name
      FROM profiles p WHERE p.id = v_ticket.user_id;
    ELSE
      SELECT o.guest_name INTO v_buyer_name
      FROM orders o WHERE o.id = v_ticket.order_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_buyer_name := 'Unknown';
  END;

  -- ═══ 12. Return full context ═══
  RETURN jsonb_build_object(
    'valid', true,
    'scan_result', v_scan_result,
    'message', CASE v_scan_result
      WHEN 'admitted' THEN 'Welcome! First entry.'
      WHEN 're_entry' THEN 'Re-entry confirmed.'
    END,

    -- Ticket info
    'ticket_id', p_ticket_id,
    'ticket_status', v_new_status,
    'scan_id', v_scan_id,

    -- Scan counts
    'scan_count', v_new_count,
    'max_scans', COALESCE(v_ticket.max_scans_allowed, 0),
    'scans_remaining', v_scans_left,
    'is_unlimited', v_is_unlimited,

    -- Event info (for scanner display)
    'event_title', v_event.title,
    'event_venue', v_event.venue,
    'tier_name', v_tier.name,
    'buyer_name', COALESCE(v_buyer_name, 'Guest'),
    'seat_label', v_ticket.seat_label
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 2: Grant Permissions ════════════

GRANT EXECUTE ON FUNCTION scan_ticket(UUID, UUID, TEXT, TEXT) TO authenticated;


-- ════════════ ✅ MIGRATION v22 TASK 1 COMPLETE ════════════
--
-- Functions created:
--   ✓ scan_ticket(ticket_id, scanned_by, device_info, ip_address)
--
-- Scan result types:
--   • 'admitted'  — First entry
--   • 're_entry'  — Returning entry (within limits)
--   • 'rejected'  — Max scans reached / invalid ticket
--   • 'duplicate' — Rapid re-scan within 3s cooldown
--
-- Status transitions:
--   valid → valid     (still has remaining scans)
--   valid → used      (max scans reached)
--
-- Verification:
--   SELECT scan_ticket('<ticket_id>', '<scanner_user_id>', 'iPhone/Safari', '192.168.1.1');
