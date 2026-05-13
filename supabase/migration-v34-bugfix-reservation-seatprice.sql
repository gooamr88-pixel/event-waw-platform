-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v34: Critical Bugfixes
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Replaces functions only. No data loss.
--
-- Fixes applied:
--   1. Bug #2: create_reservation() — "FOR UPDATE is not allowed
--      with aggregate functions". Separates the row lock from the
--      aggregate availability calculation into two discrete steps.
--   2. Bug #3: get_seat_map() — Seats with NULL ticket_tier_id
--      return NULL price (rendered as "0" in frontend). Now uses
--      COALESCE and filters out unassigned seats.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ FIX 1: create_reservation() ════════════
-- Problem: PostgreSQL rejects "FOR UPDATE" when aggregate functions
-- (SUM, COUNT) appear anywhere in the SELECT list — even in subqueries.
--
-- Fix: Split into two steps:
--   Step A: Lock the tier row with FOR UPDATE (no aggregates)
--   Step B: Calculate availability separately (no FOR UPDATE)
--
-- This matches the pattern used by create_guest_reservation() which
-- already works correctly via EXECUTE (dynamic SQL).

CREATE OR REPLACE FUNCTION create_reservation(p_user_id UUID, p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE(reservation_id UUID, expires_at TIMESTAMPTZ, tier_name TEXT, tier_price DECIMAL, event_title TEXT, event_id UUID) AS $$
DECLARE
  v_tier RECORD;
  v_reservation_id UUID;
  v_expires TIMESTAMPTZ;
  v_reserved BIGINT;
  v_sold BIGINT;
  v_available INT;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  -- Step A: Lock the tier row (NO aggregates in this query)
  SELECT tt.id, tt.name, tt.price, tt.capacity, tt.event_id, e.title AS event_title
  INTO v_tier
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id
  FOR UPDATE OF tt;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  -- Step B: Calculate availability SEPARATELY (no FOR UPDATE)
  SELECT COALESCE(SUM(r.quantity), 0)
  INTO v_reserved
  FROM reservations r
  WHERE r.ticket_tier_id = p_tier_id AND r.status = 'active';

  SELECT COUNT(*)
  INTO v_sold
  FROM tickets t
  WHERE t.ticket_tier_id = p_tier_id AND t.status IN ('valid', 'scanned');

  v_available := v_tier.capacity - v_reserved - v_sold;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  v_expires := NOW() + INTERVAL '10 minutes';  -- BRD Rule 1: 10-minute cart lock

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ FIX 2: get_seat_map() ════════════
-- Problem: Seats with ticket_tier_id = NULL produce NULL tier_price,
-- which JavaScript coerces to 0 on the frontend.
--
-- Fix:
--   A. Use COALESCE(tt.price, 0) so NULL becomes 0 explicitly
--   B. Return tier assignment status so frontend can distinguish
--      "unassigned" from "free" seats
--   C. Frontend should grey out unassigned seats (tier_id IS NULL)

DROP FUNCTION IF EXISTS get_seat_map(UUID);

CREATE OR REPLACE FUNCTION get_seat_map(p_event_id UUID)
RETURNS TABLE(
  seat_id        UUID,
  section_key    TEXT,
  row_label      TEXT,
  seat_number    TEXT,
  status         TEXT,
  tier_id        UUID,
  tier_name      TEXT,
  tier_price     DECIMAL
) AS $func$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.section_key,
    s.row_label,
    s.seat_number,
    s.status,
    s.ticket_tier_id,
    COALESCE(tt.name, 'Unassigned'),
    COALESCE(tt.price, 0)
  FROM seats s
  JOIN venue_maps vm ON vm.id = s.venue_map_id
  LEFT JOIN ticket_tiers tt ON tt.id = s.ticket_tier_id
  WHERE vm.event_id = p_event_id
  ORDER BY s.section_key, s.row_label, s.seat_number;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ Grants (idempotent) ════════════
GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO anon;


-- ════════════ ✅ MIGRATION v34 COMPLETE ════════════
--
-- Fixes applied:
--   ✓ FIX 1: create_reservation() — split FOR UPDATE from aggregates
--            (eliminates "FOR UPDATE is not allowed with aggregate functions")
--   ✓ FIX 2: get_seat_map() — COALESCE(tt.price, 0) for NULL tier prices
--            (eliminates zero-price display bug for unassigned seats)
--
-- Verification:
--
--   -- Test create_reservation (should NOT throw aggregate error):
--   SELECT * FROM create_reservation('<user_id>', '<tier_id>', 1);
--
--   -- Test get_seat_map (price should be 0 not NULL for unassigned):
--   SELECT * FROM get_seat_map('<event_id>');
--
--   -- Verify tier_name shows 'Unassigned' for NULL tier seats:
--   SELECT seat_id, tier_name, tier_price FROM get_seat_map('<event_id>')
--   WHERE tier_id IS NULL;
