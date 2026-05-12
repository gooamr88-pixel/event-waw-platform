-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v19 Phase 1 Task 4 (FIXED)
-- THE 10-MINUTE FIX: Updates all reservation functions
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Drops and recreates functions only.
-- No data loss. Fully idempotent.
--
-- FIX: Added DROP FUNCTION before CREATE to handle
-- PostgreSQL's "cannot change return type" restriction.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ FIX 1: create_reservation() ════════════
-- 35 min → 10 min

DROP FUNCTION IF EXISTS create_reservation(UUID, UUID, INT);

CREATE OR REPLACE FUNCTION create_reservation(p_user_id UUID, p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE(reservation_id UUID, expires_at TIMESTAMPTZ, tier_name TEXT, tier_price DECIMAL, event_title TEXT, event_id UUID) AS $$
DECLARE v_tier RECORD; v_reservation_id UUID; v_expires TIMESTAMPTZ;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN RAISE EXCEPTION 'Quantity must be between 1 and 10'; END IF;
  SELECT tt.id, tt.name, tt.price, tt.capacity, tt.event_id, e.title AS event_title,
    tt.capacity - COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.ticket_tier_id = tt.id AND r.status = 'active'), 0)
    - COALESCE((SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned')), 0) AS available
  INTO v_tier FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id WHERE tt.id = p_tier_id FOR UPDATE OF tt;
  IF v_tier IS NULL THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;
  IF v_tier.available < p_quantity THEN RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_tier.available; END IF;

  -- ═══ THE FIX: 10 minutes instead of 35 ═══
  v_expires := NOW() + INTERVAL '10 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active') RETURNING id INTO v_reservation_id;
  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ FIX 2: create_guest_reservation() ════════════
-- 35 min → 10 min

DROP FUNCTION IF EXISTS create_guest_reservation(UUID, INT);

CREATE OR REPLACE FUNCTION create_guest_reservation(p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS JSONB AS $func$
DECLARE
  v_name TEXT; v_price DECIMAL; v_eid UUID; v_etitle TEXT; v_oid UUID;
  v_cap INT; v_reserved BIGINT; v_sold BIGINT; v_available INT;
  v_expires TIMESTAMPTZ; v_rid UUID;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  EXECUTE 'SELECT tt.name, tt.price, tt.event_id, e.title, e.organizer_id, tt.capacity
    FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id
    WHERE tt.id = $1 FOR UPDATE OF tt'
  INTO v_name, v_price, v_eid, v_etitle, v_oid, v_cap
  USING p_tier_id;

  IF v_name IS NULL THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;

  EXECUTE 'SELECT COALESCE(SUM(quantity), 0) FROM reservations
    WHERE ticket_tier_id = $1 AND status = ''active'''
  INTO v_reserved USING p_tier_id;

  EXECUTE 'SELECT COUNT(*) FROM tickets
    WHERE ticket_tier_id = $1 AND status IN (''valid'',''scanned'')'
  INTO v_sold USING p_tier_id;

  v_available := v_cap - v_reserved - v_sold;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  -- ═══ THE FIX: 10 minutes instead of 35 ═══
  v_expires := NOW() + INTERVAL '10 minutes';

  EXECUTE 'INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
    VALUES (NULL, $1, $2, $3, ''active'') RETURNING id'
  INTO v_rid USING p_tier_id, p_quantity, v_expires;

  RETURN jsonb_build_object(
    'reservation_id', v_rid, 'expires_at', v_expires,
    'tier_name', v_name, 'tier_price', v_price,
    'event_title', v_etitle, 'event_id', v_eid, 'organizer_id', v_oid
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ FIX 3: reserve_seats() ════════════
-- 35 min → 10 min

DROP FUNCTION IF EXISTS reserve_seats(UUID, UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_seats(
  p_user_id   UUID,
  p_seat_ids  UUID[],
  p_tier_id   UUID
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
  v_seat_count := array_length(p_seat_ids, 1);

  IF v_seat_count IS NULL OR v_seat_count < 1 THEN
    RAISE EXCEPTION 'At least 1 seat must be selected';
  END IF;

  IF v_seat_count > 10 THEN
    RAISE EXCEPTION 'Cannot reserve more than 10 seats at once';
  END IF;

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

  SELECT array_agg(s.id)
  INTO v_locked_ids
  FROM seats s
  WHERE s.id = ANY(p_seat_ids)
    AND s.status = 'available'
    AND s.ticket_tier_id = p_tier_id
  FOR UPDATE SKIP LOCKED;

  v_locked_count := COALESCE(array_length(v_locked_ids, 1), 0);

  IF v_locked_count != v_seat_count THEN
    RAISE EXCEPTION 'One or more selected seats are no longer available. Please refresh and try again.';
  END IF;

  -- ═══ THE FIX: 10 minutes instead of 35 ═══
  v_expires := now() + INTERVAL '10 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, v_seat_count, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  UPDATE seats
  SET status         = 'reserved',
      reservation_id = v_reservation_id,
      locked_until   = v_expires
  WHERE id = ANY(v_locked_ids);

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


-- ════════════ FIX 4: reserve_guest_seats() ════════════

DROP FUNCTION IF EXISTS reserve_guest_seats(UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_guest_seats(
  p_seat_ids  UUID[],
  p_tier_id   UUID
)
RETURNS JSONB AS $func$
BEGIN
  RETURN reserve_seats(NULL, p_seat_ids, p_tier_id);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ RE-GRANT EXECUTE PERMISSIONS ════════════

GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_seats(UUID, UUID[], UUID) TO authenticated;


-- ════════════ ✅ MIGRATION v19 TASK 4 COMPLETE ════════════
