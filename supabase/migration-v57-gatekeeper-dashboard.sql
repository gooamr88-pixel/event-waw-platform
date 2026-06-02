-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v57: Gate Lead Dashboard RPCs
-- ═══════════════════════════════════════════════════════════════
-- Purpose: Backend support for the Flutter Gatekeeper Gate Lead
--          Dashboard (Phase 4). Provides three RPCs:
--
--   1. get_event_scan_stats     — admission metrics + hourly histogram
--   2. get_scanner_team_status  — live scanner roster with heartbeats
--   3. manual_admit_ticket      — gate_lead override admission
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- RPC 1: get_event_scan_stats
-- ═══════════════════════════════════════════════════════════════
-- Returns real-time admission statistics for an event:
--   - total_tickets, total_scanned, unique_admissions, re_entries
--   - admission_rate (%), tickets_remaining
--   - hourly_histogram: [{hour, count}] for the last 24 hours

CREATE OR REPLACE FUNCTION get_event_scan_stats(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         UUID := auth.uid();
  v_authorized      BOOLEAN := false;
  v_total_tickets   INT;
  v_total_scanned   INT;
  v_unique_admits   INT;
  v_re_entries      INT;
  v_cancelled       INT;
  v_histogram       JSONB;
  v_by_tier         JSONB;
BEGIN
  -- ─── Authorization ───────────────────────────────────
  -- Must be organizer, gate_lead, or admin
  IF EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM gate_team
    WHERE event_id = p_event_id
      AND staff_user_id = v_user_id
      AND status = 'active'
      AND role = 'gate_lead'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM profiles WHERE id = v_user_id AND role = 'admin'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('error', 'Not authorized to view stats for this event');
  END IF;

  -- ─── Total tickets ──────────────────────────────────
  SELECT COUNT(*)
  INTO v_total_tickets
  FROM tickets
  WHERE event_id = p_event_id
    AND status IN ('valid', 'used');

  -- ─── Cancelled / refunded ───────────────────────────
  SELECT COUNT(*)
  INTO v_cancelled
  FROM tickets
  WHERE event_id = p_event_id
    AND status IN ('cancelled', 'refunded', 'revoked');

  -- ─── Unique admissions (tickets scanned at least once) ──
  SELECT COUNT(*)
  INTO v_unique_admits
  FROM tickets
  WHERE event_id = p_event_id
    AND scan_count > 0
    AND status IN ('valid', 'used');

  -- ─── Total scan operations ──────────────────────────
  SELECT COALESCE(SUM(scan_count), 0)
  INTO v_total_scanned
  FROM tickets
  WHERE event_id = p_event_id
    AND status IN ('valid', 'used');

  -- ─── Re-entries ─────────────────────────────────────
  v_re_entries := v_total_scanned - v_unique_admits;
  IF v_re_entries < 0 THEN v_re_entries := 0; END IF;

  -- ─── Hourly histogram (last 24 hours from scans table) ──
  SELECT COALESCE(jsonb_agg(h_row ORDER BY h_row->>'hour'), '[]'::jsonb)
  INTO v_histogram
  FROM (
    SELECT jsonb_build_object(
      'hour', to_char(date_trunc('hour', s.scanned_at), 'HH24:MI'),
      'count', COUNT(*)
    ) AS h_row
    FROM scans s
    JOIN tickets t ON t.id = s.ticket_id
    WHERE t.event_id = p_event_id
      AND s.scanned_at >= NOW() - INTERVAL '24 hours'
    GROUP BY date_trunc('hour', s.scanned_at)
  ) sub;

  -- ─── Per-tier breakdown ─────────────────────────────
  SELECT COALESCE(jsonb_agg(tier_row), '[]'::jsonb)
  INTO v_by_tier
  FROM (
    SELECT jsonb_build_object(
      'tier_name', tt.name,
      'total', COUNT(t.id),
      'scanned', COUNT(t.id) FILTER (WHERE t.scan_count > 0),
      'remaining', COUNT(t.id) FILTER (WHERE t.scan_count = 0)
    ) AS tier_row
    FROM tickets t
    JOIN ticket_types tt ON tt.id = t.ticket_type_id
    WHERE t.event_id = p_event_id
      AND t.status IN ('valid', 'used')
    GROUP BY tt.name
    ORDER BY tt.name
  ) sub;

  RETURN jsonb_build_object(
    'total_tickets',     v_total_tickets,
    'total_scans',       v_total_scanned,
    'unique_admissions', v_unique_admits,
    're_entries',        v_re_entries,
    'cancelled',         v_cancelled,
    'tickets_remaining', v_total_tickets - v_unique_admits,
    'admission_rate',    CASE WHEN v_total_tickets > 0
                           THEN ROUND((v_unique_admits::numeric / v_total_tickets) * 100, 1)
                           ELSE 0 END,
    'hourly_histogram',  v_histogram,
    'by_tier',           v_by_tier,
    'fetched_at',        NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_event_scan_stats(UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- RPC 2: get_scanner_team_status
-- ═══════════════════════════════════════════════════════════════
-- Returns the scanner team roster with live status.

CREATE OR REPLACE FUNCTION get_scanner_team_status(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_authorized BOOLEAN := false;
  v_team       JSONB;
BEGIN
  -- ─── Authorization ───────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM gate_team
    WHERE event_id = p_event_id
      AND staff_user_id = v_user_id
      AND status = 'active'
      AND role = 'gate_lead'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM profiles WHERE id = v_user_id AND role = 'admin'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('error', 'Not authorized');
  END IF;

  -- ─── Team roster ────────────────────────────────────
  SELECT COALESCE(jsonb_agg(member_row), '[]'::jsonb)
  INTO v_team
  FROM (
    SELECT jsonb_build_object(
      'id',             gt.id,
      'staff_name',     gt.staff_name,
      'staff_email',    gt.staff_email,
      'role',           gt.role,
      'status',         gt.status,
      'device_id',      gt.device_id,
      'last_active_at', gt.last_active_at,
      'is_online',      (gt.last_active_at IS NOT NULL
                          AND gt.last_active_at > NOW() - INTERVAL '2 minutes'),
      'session',        (
        SELECT jsonb_build_object(
          'session_id',       ss.id,
          'started_at',       ss.started_at,
          'total_scans',      ss.total_scans,
          'successful_scans', ss.successful_scans,
          'rejected_scans',   ss.rejected_scans,
          'is_active',        ss.is_active
        )
        FROM scanner_sessions ss
        WHERE ss.gate_team_id = gt.id
          AND ss.event_id = p_event_id
          AND ss.is_active = true
        ORDER BY ss.started_at DESC
        LIMIT 1
      )
    ) AS member_row
    FROM gate_team gt
    WHERE gt.event_id = p_event_id
      AND gt.status IN ('active', 'invited')
    ORDER BY
      (gt.last_active_at > NOW() - INTERVAL '2 minutes') DESC NULLS LAST,
      gt.role DESC,
      gt.staff_name ASC
  ) sub;

  RETURN jsonb_build_object(
    'team', v_team,
    'total_members', jsonb_array_length(v_team),
    'online_count', (
      SELECT COUNT(*) FROM gate_team
      WHERE event_id = p_event_id
        AND status = 'active'
        AND last_active_at > NOW() - INTERVAL '2 minutes'
    ),
    'fetched_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_scanner_team_status(UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- RPC 3: manual_admit_ticket
-- ═══════════════════════════════════════════════════════════════
-- Allows a gate_lead to manually admit a ticket, bypassing normal
-- QR scan flow. Used for override situations (e.g., damaged QR,
-- phone dead, VIP fast-track).

CREATE OR REPLACE FUNCTION manual_admit_ticket(
  p_event_id  UUID,
  p_ticket_id UUID,
  p_reason    TEXT DEFAULT 'Manual gate lead override'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_authorized   BOOLEAN := false;
  v_ticket       RECORD;
  v_buyer_name   TEXT;
  v_tier_name    TEXT;
BEGIN
  -- ─── Authorization: gate_lead, organizer, or admin only ──
  IF EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM gate_team
    WHERE event_id = p_event_id
      AND staff_user_id = v_user_id
      AND status = 'active'
      AND role = 'gate_lead'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM profiles WHERE id = v_user_id AND role = 'admin'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only gate leads, organizers, and admins can manually admit tickets'
    );
  END IF;

  -- ─── Fetch ticket ───────────────────────────────────
  SELECT t.*, tt.name AS tier_name,
         COALESCE(o.buyer_name, o.buyer_email, 'Guest') AS buyer_name
  INTO v_ticket
  FROM tickets t
  LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
  LEFT JOIN orders o ON o.id = t.order_id
  WHERE t.id = p_ticket_id AND t.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ticket not found for this event'
    );
  END IF;

  -- ─── Status check (allow override on valid/used, reject on cancelled) ──
  IF v_ticket.status IN ('cancelled', 'refunded', 'revoked') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot admit: ticket is %s', v_ticket.status),
      'ticket_status', v_ticket.status
    );
  END IF;

  -- ─── Admit the ticket ──────────────────────────────
  UPDATE tickets
  SET scan_count = scan_count + 1,
      status = CASE
        WHEN max_scans_allowed > 0 AND scan_count + 1 >= max_scans_allowed THEN 'used'
        ELSE status
      END,
      updated_at = NOW()
  WHERE id = p_ticket_id;

  -- ─── Insert scan record ────────────────────────────
  INSERT INTO scans (ticket_id, scanned_by, scanned_at, scan_method, notes)
  VALUES (
    p_ticket_id,
    v_user_id,
    NOW(),
    'manual_override',
    p_reason
  );

  RETURN jsonb_build_object(
    'success',    true,
    'message',    format('Manually admitted: %s', v_ticket.buyer_name),
    'ticket_id',  p_ticket_id,
    'buyer_name', v_ticket.buyer_name,
    'tier_name',  v_ticket.tier_name,
    'scan_count', v_ticket.scan_count + 1,
    'status',     CASE
      WHEN v_ticket.max_scans_allowed > 0
        AND v_ticket.scan_count + 1 >= v_ticket.max_scans_allowed
      THEN 'used' ELSE v_ticket.status END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION manual_admit_ticket(UUID, UUID, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════
SELECT 'get_event_scan_stats created' AS rpc_1;
SELECT 'get_scanner_team_status created' AS rpc_2;
SELECT 'manual_admit_ticket created' AS rpc_3;
