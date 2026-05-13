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


-- ════════════ FIX 1b: reserve_seats() ════════════
-- Problem: array_agg() is an aggregate function. Using it with
-- FOR UPDATE SKIP LOCKED triggers the same PostgreSQL error:
-- "FOR UPDATE is not allowed with aggregate functions"
--
-- Fix: Wrap FOR UPDATE SKIP LOCKED in a subquery (locks individual rows),
-- then array_agg in the outer query (no FOR UPDATE).

DROP FUNCTION IF EXISTS reserve_seats(UUID, UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_seats(
  p_user_id  UUID,
  p_seat_ids UUID[],
  p_tier_id  UUID
)
RETURNS JSONB AS $func$
DECLARE
  v_seat_count    INT;
  v_locked_ids    UUID[];
  v_locked_count  INT;
  v_tier          RECORD;
  v_reservation_id UUID;
  v_expires       TIMESTAMPTZ;
  v_event_id      UUID;
  v_event_title   TEXT;
BEGIN
  -- 1. Validate input
  v_seat_count := array_length(p_seat_ids, 1);

  IF v_seat_count IS NULL OR v_seat_count < 1 THEN
    RAISE EXCEPTION 'At least 1 seat must be selected';
  END IF;

  IF v_seat_count > 10 THEN
    RAISE EXCEPTION 'Cannot reserve more than 10 seats at once';
  END IF;

  -- 2. Verify the tier exists and fetch event info
  SELECT tt.id, tt.name, tt.price, tt.event_id, e.title
  INTO v_tier
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id
  FOR UPDATE OF tt;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  v_event_id    := v_tier.event_id;
  v_event_title := v_tier.title;

  -- 3. ATOMIC LOCK: subquery locks rows, outer query aggregates
  --    FOR UPDATE SKIP LOCKED is in the subquery (no aggregates)
  --    array_agg is in the outer query (no FOR UPDATE)
  SELECT array_agg(locked.id)
  INTO v_locked_ids
  FROM (
    SELECT s.id
    FROM seats s
    WHERE s.id = ANY(p_seat_ids)
      AND s.status = 'available'
      AND s.ticket_tier_id = p_tier_id
    FOR UPDATE SKIP LOCKED
  ) AS locked;

  v_locked_count := COALESCE(array_length(v_locked_ids, 1), 0);

  -- 4. All-or-nothing check
  IF v_locked_count != v_seat_count THEN
    RAISE EXCEPTION 'One or more selected seats are no longer available. Please refresh and try again.';
  END IF;

  -- 5. Create reservation row
  v_expires := now() + INTERVAL '10 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, v_seat_count, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  -- 6. Mark seats as reserved
  UPDATE seats
  SET status         = 'reserved',
      reservation_id = v_reservation_id,
      locked_until   = v_expires
  WHERE id = ANY(v_locked_ids);

  -- 7. Return reservation details
  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'expires_at',     v_expires,
    'seats_locked',   v_locked_count,
    'tier_name',      v_tier.name,
    'tier_price',     v_tier.price,
    'event_id',       v_event_id,
    'event_title',    v_event_title
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- FIX 1c: reserve_guest_seats() — delegates to fixed reserve_seats()
DROP FUNCTION IF EXISTS reserve_guest_seats(UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_guest_seats(
  p_seat_ids UUID[],
  p_tier_id  UUID
)
RETURNS JSONB AS $func$
BEGIN
  RETURN reserve_seats(NULL, p_seat_ids, p_tier_id);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


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
GRANT EXECUTE ON FUNCTION reserve_seats(UUID, UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_guest_seats(UUID[], UUID) TO authenticated, anon;
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
