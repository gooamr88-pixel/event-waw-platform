-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v36: Security Audit Fixes
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: No data loss. Replaces functions + revokes grants.
--
-- Fixes applied:
--   S-1  (CRITICAL): Revoke anon access from calculate_order_breakdown
--   Q-2  (HIGH):     Extend reservation TTL from 10min to 35min
--                    (aligns with Stripe session expiry of 30.5min)
--   Q-3  (HIGH):     Create webhook_failures table for recovery logging
-- ═══════════════════════════════════════════════════════════════


-- ════════════ Q-3: WEBHOOK FAILURES TABLE ════════════
-- Recovery log for critical webhook failures (e.g. payment record creation).
-- Admins can query this table to find and manually reconcile missing records.

CREATE TABLE IF NOT EXISTS webhook_failures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT,
  order_id          UUID,
  error             TEXT NOT NULL,
  payload           JSONB,
  resolved          BOOLEAN DEFAULT false,
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_failures_unresolved
  ON webhook_failures(resolved) WHERE resolved = false;

ALTER TABLE webhook_failures ENABLE ROW LEVEL SECURITY;

-- Only admins can read/update webhook failures
CREATE POLICY "webhook_failures_admin_select" ON webhook_failures
  FOR SELECT USING (is_admin());
CREATE POLICY "webhook_failures_admin_update" ON webhook_failures
  FOR UPDATE USING (is_admin());
-- Service role inserts (from webhook Edge Function)
CREATE POLICY "webhook_failures_service_insert" ON webhook_failures
  FOR INSERT WITH CHECK (true);

GRANT SELECT, UPDATE ON webhook_failures TO authenticated;
GRANT INSERT ON webhook_failures TO authenticated;


-- ════════════ S-1: REVOKE ANON ACCESS TO PRICING RPC ════════════
-- The checkout Edge Function calls this with service_role anyway.
-- Anon access allows anyone to enumerate tier pricing and org tax config.

REVOKE EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) FROM anon;


-- ════════════ Q-2: EXTEND RESERVATION TTL TO 35 MINUTES ════════════
-- Problem: Reservation expires in 10min but Stripe session lasts 30.5min.
-- A customer paying at minute 15 gets auto-refunded on an expired reservation.
-- Fix: Extend reservation to 35min (5min buffer past Stripe session).

-- FIX 2a: create_reservation (GA checkout)
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

  -- Q-2 FIX: Extended from 10min to 35min to align with Stripe session (30.5min)
  v_expires := NOW() + INTERVAL '35 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- FIX 2b: reserve_seats (seated checkout)
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
  -- Q-2 FIX: Extended from 10min to 35min to align with Stripe session (30.5min)
  v_expires := now() + INTERVAL '35 minutes';

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


-- FIX 2c: create_guest_reservation (guest GA checkout)
-- Find and replace the 10 minute interval in guest reservation too
CREATE OR REPLACE FUNCTION create_guest_reservation(p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS JSONB AS $func$
DECLARE
  v_tier RECORD;
  v_rid UUID;
  v_expires TIMESTAMPTZ;
  v_reserved BIGINT;
  v_sold BIGINT;
  v_available INT;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  -- Lock tier row
  SELECT tt.id, tt.name, tt.price, tt.capacity, tt.event_id, e.title AS event_title
  INTO v_tier
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id
  FOR UPDATE OF tt;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  -- Availability check
  SELECT COALESCE(SUM(r.quantity), 0) INTO v_reserved
  FROM reservations r WHERE r.ticket_tier_id = p_tier_id AND r.status = 'active';

  SELECT COUNT(*) INTO v_sold
  FROM tickets t WHERE t.ticket_tier_id = p_tier_id AND t.status IN ('valid', 'scanned');

  v_available := v_tier.capacity - v_reserved - v_sold;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  -- Q-2 FIX: Extended from 10min to 35min to align with Stripe session (30.5min)
  v_expires := NOW() + INTERVAL '35 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (NULL, p_tier_id, p_quantity, v_expires, 'active')
  RETURNING id INTO v_rid;

  RETURN jsonb_build_object(
    'reservation_id', v_rid,
    'expires_at', v_expires,
    'tier_name', v_tier.name,
    'tier_price', v_tier.price,
    'event_title', v_tier.event_title,
    'event_id', v_tier.event_id
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ Grants (idempotent) ════════════
GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_seats(UUID, UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_guest_seats(UUID[], UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION create_guest_reservation(UUID, INT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) TO authenticated;


-- ════════════ ✅ MIGRATION v36 COMPLETE ════════════
--
-- Verification:
--
--   -- S-1: Verify anon can't call pricing RPC:
--   -- (Should fail with "permission denied")
--   -- SET ROLE anon; SELECT calculate_order_breakdown('<tier_id>', 1, NULL); RESET ROLE;
--
--   -- Q-2: Verify reservation TTL is 35min:
--   SELECT * FROM create_reservation('<user_id>', '<tier_id>', 1);
--   -- Check expires_at is ~35min from now
