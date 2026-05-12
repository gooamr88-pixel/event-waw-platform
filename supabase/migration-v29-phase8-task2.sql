-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v29 Phase 8 Task 2
-- Manual Check-in: Search + Admit RPCs
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates/replaces functions only. Idempotent.
--
-- BRD Section 20:
--   "يجب توفير طريقة يدوية لتسجيل الحضور في حال عدم عمل الـ QR"
--   "يبحث حارس البوابة بالاسم أو رقم الطلب ويسجل الدخول يدوياً"
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: manual_checkin_search ════════════
-- Searches for tickets by attendee name, email, or order ID
-- within a specific event. Returns matching tickets.

CREATE OR REPLACE FUNCTION manual_checkin_search(
  p_event_id UUID,
  p_query TEXT
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_search TEXT;
  v_result JSONB;
BEGIN
  -- Must be organizer of this event
  IF NOT EXISTS (
    SELECT 1 FROM events e WHERE e.id = p_event_id AND e.organizer_id = v_user_id
  ) THEN
    -- Or admin
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_user_id AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
      RETURN jsonb_build_object('error', 'Unauthorized: You do not own this event');
    END IF;
  END IF;

  -- Sanitize search
  v_search := LOWER(TRIM(p_query));
  IF LENGTH(v_search) < 2 THEN
    RETURN jsonb_build_object('error', 'Search query must be at least 2 characters');
  END IF;

  -- Search tickets
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      t.id AS ticket_id,
      t.status AS ticket_status,
      t.scanned_at,
      t.scan_count,
      t.max_scans,
      t.seat_section,
      t.seat_row,
      t.seat_number,
      t.attendee_name,
      t.attendee_email,
      t.created_at,
      tt.name AS tier_name,
      tt.price AS tier_price,
      o.id AS order_id,
      o.guest_name,
      o.guest_email,
      COALESCE(t.attendee_name, o.guest_name, 'Guest') AS display_name,
      COALESCE(t.attendee_email, o.guest_email, '') AS display_email
    FROM tickets t
    JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
    LEFT JOIN orders o ON o.id = t.order_id
    WHERE tt.event_id = p_event_id
      AND t.status IN ('valid', 'used')
      AND (
        -- Search by attendee name
        LOWER(COALESCE(t.attendee_name, '')) LIKE '%' || v_search || '%'
        -- Search by guest name (order)
        OR LOWER(COALESCE(o.guest_name, '')) LIKE '%' || v_search || '%'
        -- Search by attendee email
        OR LOWER(COALESCE(t.attendee_email, '')) LIKE '%' || v_search || '%'
        -- Search by guest email (order)
        OR LOWER(COALESCE(o.guest_email, '')) LIKE '%' || v_search || '%'
        -- Search by order ID (partial match)
        OR LOWER(CAST(t.order_id AS TEXT)) LIKE '%' || v_search || '%'
        -- Search by ticket ID (partial match)
        OR LOWER(CAST(t.id AS TEXT)) LIKE '%' || v_search || '%'
      )
    ORDER BY
      CASE WHEN t.scanned_at IS NULL THEN 0 ELSE 1 END,
      t.created_at DESC
    LIMIT 20
  ) r;

  RETURN v_result;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════ STEP 2: manual_checkin_admit ════════════
-- Manually marks a ticket as scanned. Records the manual check-in.

CREATE OR REPLACE FUNCTION manual_checkin_admit(
  p_ticket_id UUID,
  p_event_id UUID
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_ticket RECORD;
  v_tier_name TEXT;
  v_display_name TEXT;
BEGIN
  -- Must be organizer of this event or admin
  IF NOT EXISTS (
    SELECT 1 FROM events e WHERE e.id = p_event_id AND e.organizer_id = v_user_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_user_id AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
      RETURN jsonb_build_object('error', 'Unauthorized');
    END IF;
  END IF;

  -- Lock and fetch ticket
  SELECT t.*, tt.name AS tier_name, tt.event_id
  INTO v_ticket
  FROM tickets t
  JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
  WHERE t.id = p_ticket_id
  FOR UPDATE OF t;

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('error', 'Ticket not found');
  END IF;

  -- Verify event match
  IF v_ticket.event_id != p_event_id THEN
    RETURN jsonb_build_object('error', 'Ticket does not belong to this event');
  END IF;

  -- Check status
  IF v_ticket.status NOT IN ('valid', 'used') THEN
    RETURN jsonb_build_object('error', 'Ticket status is: ' || v_ticket.status || '. Cannot check in.');
  END IF;

  -- Check multi-scan limits
  IF v_ticket.max_scans IS NOT NULL AND v_ticket.max_scans > 0
     AND v_ticket.scan_count >= v_ticket.max_scans THEN
    RETURN jsonb_build_object(
      'error', 'Maximum scans reached',
      'scan_count', v_ticket.scan_count,
      'max_scans', v_ticket.max_scans
    );
  END IF;

  v_tier_name := v_ticket.tier_name;
  v_display_name := COALESCE(v_ticket.attendee_name, 'Guest');

  -- Update ticket
  UPDATE tickets SET
    status = 'used',
    scanned_at = COALESCE(scanned_at, now()),  -- Keep first scan time
    scan_count = COALESCE(scan_count, 0) + 1,
    updated_at = now()
  WHERE id = p_ticket_id;

  -- Log the scan in scans table if it exists
  BEGIN
    INSERT INTO scans (ticket_id, scanned_by, device_info, ip_address, scan_result)
    VALUES (
      p_ticket_id,
      v_user_id,
      'Manual Check-in (Scanner UI)',
      '0.0.0.0',
      CASE WHEN v_ticket.scanned_at IS NULL THEN 'first_entry' ELSE 're_entry' END
    );
  EXCEPTION WHEN undefined_table THEN
    NULL; -- scans table may not exist
  END;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'attendee_name', v_display_name,
    'tier_name', v_tier_name,
    'scan_type', CASE WHEN v_ticket.scanned_at IS NULL THEN 'first_entry' ELSE 're_entry' END,
    'scan_count', COALESCE(v_ticket.scan_count, 0) + 1,
    'max_scans', v_ticket.max_scans,
    'message', v_display_name || ' checked in successfully'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 3: Grants ════════════
GRANT EXECUTE ON FUNCTION manual_checkin_search(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION manual_checkin_admit(UUID, UUID) TO authenticated;


-- ════════════ ✅ MIGRATION v29 TASK 2 COMPLETE ════════════
--
-- RPCs created:
--   ✓ manual_checkin_search(event_id, query) → JSONB array
--   ✓ manual_checkin_admit(ticket_id, event_id) → JSONB
--
-- Security:
--   ✓ Organizer ownership check
--   ✓ Admin bypass
--   ✓ FOR UPDATE lock on ticket row
--   ✓ Multi-scan limit enforcement
--
-- Test:
--   SELECT manual_checkin_search('event-uuid', 'john');
--   SELECT manual_checkin_admit('ticket-uuid', 'event-uuid');
