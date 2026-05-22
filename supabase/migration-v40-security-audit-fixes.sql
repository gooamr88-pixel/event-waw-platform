-- ============================================
-- Migration v40: Security Audit Fixes
-- Date: 2026-05-22
-- Audit findings: H-1, H-4, C-6, M-10, H-12
-- ============================================

BEGIN;

-- ── H-1 FIX: Ensure FOR UPDATE lock on create_reservation ──
-- Prevents overselling under concurrent flash-sale load.
-- The v36 version already locks the tier row with FOR UPDATE OF tt,
-- but the availability calculation was split across two queries.
-- This version preserves the v36 signature and logic while ensuring
-- the lock + availability check is fully documented.
--
-- NOTE: Preserves the existing 3-arg signature:
--   create_reservation(p_user_id UUID, p_tier_id UUID, p_quantity INT)
-- The reservation uses ticket_tier_id (not tier_id) per base schema.

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

  -- H-1: Lock the tier row to prevent concurrent overselling
  SELECT tt.id, tt.name, tt.price, tt.capacity, tt.event_id, e.title AS event_title
  INTO v_tier
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id
  FOR UPDATE OF tt;  -- Row-level lock prevents race conditions

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  -- Calculate active reservations (separate query, no FOR UPDATE needed)
  SELECT COALESCE(SUM(r.quantity), 0)
  INTO v_reserved
  FROM reservations r
  WHERE r.ticket_tier_id = p_tier_id AND r.status = 'active';

  -- Calculate sold tickets
  SELECT COUNT(*)
  INTO v_sold
  FROM tickets t
  WHERE t.ticket_tier_id = p_tier_id AND t.status IN ('valid', 'scanned');

  v_available := v_tier.capacity - v_reserved - v_sold;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  -- 35 minutes: aligns with Stripe session expiry (30.5min) + 5min buffer
  v_expires := NOW() + INTERVAL '35 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-grant execute permission (idempotent)
GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;


-- ── H-4 FIX: UPDATE RLS policy for tickets (enables ticket transfer) ──
-- Previously tickets had no UPDATE policy, blocking ticket transfer
-- (attendee_name/attendee_email changes via migration-v30).
DO $$ BEGIN
  DROP POLICY IF EXISTS "tickets_update_own" ON tickets;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "tickets_update_own" ON tickets
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── C-6 FIX: Payout idempotency — prevent double payouts ──
-- The payments table already has a UNIQUE constraint on order_id
-- (one payment per order), which prevents duplicate payment records.
-- However, there is no guard against creating duplicate payouts
-- for the same event by the same organizer.
-- This partial unique index prevents duplicate non-failed payouts
-- per event per organizer (a single payout per event is the norm).
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_payout_per_event
  ON payouts (organizer_id, event_id)
  WHERE status NOT IN ('failed', 'cancelled');


-- ── M-10 FIX: Missing index on orders.event_id ──
-- Speeds up RLS policy joins (orders_select_organizer) and
-- fulfill_checkout's escrow bypass trigger queries.
CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);


-- ── H-12 FIX: Harden RLS on payments table ──
-- RLS is already ENABLED on payments (migration-v19-phase1-task1),
-- and policies exist for buyer, organizer, and admin SELECT.
-- However, we need to ensure the policy definitions are robust.
-- Re-create the organizer policy to use a safer join path
-- (via orders → events) for consistency with the orders RLS pattern.

DO $$ BEGIN
  DROP POLICY IF EXISTS "payments_select_organizer" ON payments;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "payments_select_organizer" ON payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders o
      JOIN events e ON o.event_id = e.id
      WHERE o.id = payments.order_id
      AND e.organizer_id = auth.uid()
    )
  );

-- Also ensure RLS is enabled (idempotent, no-op if already enabled)
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

COMMIT;
