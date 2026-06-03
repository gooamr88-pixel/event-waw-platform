-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v56: Gatekeeper Prefetch RPC
-- ═══════════════════════════════════════════════════════════════
-- Purpose: Adds the prefetch_event_tickets RPC for the Flutter
--          Gatekeeper app's offline cache warming (Phase 3).
--
-- Security: SECURITY DEFINER. Validates that the calling user
--           is an organizer, gate_team member, or admin for the
--           requested event before returning any data.
--
-- Returns:  JSONB with { tickets: [...], total_count: int }
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prefetch_event_tickets(
  p_event_id UUID,
  p_limit    INT DEFAULT 1000,
  p_offset   INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_authorized BOOLEAN := false;
  v_tickets    JSONB;
  v_total      INT;
BEGIN
  -- ─── Authorization Check ───────────────────────────────
  -- 1. Check if user is the event organizer
  IF EXISTS (
    SELECT 1 FROM events
    WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    v_authorized := true;
  END IF;

  -- 2. Check if user is on the gate team
  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM gate_team
    WHERE event_id = p_event_id
      AND staff_user_id = v_user_id
      AND status = 'active'
  ) THEN
    v_authorized := true;
  END IF;

  -- 3. Check if user is an admin
  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_user_id AND role IN ('super_admin', 'admin', 'moderator')
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'error', 'Not authorized to prefetch tickets for this event'
    );
  END IF;

  -- ─── Clamp pagination ─────────────────────────────────
  IF p_limit > 2000 THEN
    p_limit := 2000;
  END IF;

  -- ─── Get total count ──────────────────────────────────
  SELECT COUNT(*)
  INTO v_total
  FROM tickets
  WHERE event_id = p_event_id
    AND status IN ('valid', 'used');

  -- ─── Fetch tickets page ────────────────────────────────
  SELECT COALESCE(jsonb_agg(t_row), '[]'::jsonb)
  INTO v_tickets
  FROM (
    SELECT jsonb_build_object(
      'id',                 t.id,
      'qr_hash',            t.qr_hash,
      'status',             t.status,
      'scan_count',         COALESCE(t.scan_count, 0),
      'max_scans_allowed',  COALESCE(t.max_scans_allowed, 0),
      'tier_name',          tt.name,
      'buyer_name',         COALESCE(o.buyer_name, o.buyer_email, 'Guest'),
      'seat_label',         t.seat_label
    ) AS t_row
    FROM tickets t
    LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
    LEFT JOIN orders o ON o.id = t.order_id
    WHERE t.event_id = p_event_id
      AND t.status IN ('valid', 'used')
    ORDER BY t.created_at ASC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'tickets',     v_tickets,
    'total_count', v_total
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION prefetch_event_tickets(UUID, INT, INT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════
SELECT 'prefetch_event_tickets RPC created successfully' AS status;
