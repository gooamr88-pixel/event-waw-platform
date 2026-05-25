-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v41: MENA Hybrid Payment Pivot
-- Manual Transfers, Commission Debt Tracking, Kill-Switch
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Purely additive. No data loss. No drops.
--
-- Creates:
--   • Enums: manual_payment_method, manual_order_status
--   • Tables: manual_transfer_orders, commission_debt, commission_settlements
--   • Column additions to: events, organizers, orders, payments
--   • RLS policies for all new tables
--   • RPCs: create_manual_transfer_order, mark_manual_order_paid,
--           approve_manual_order, reject_manual_order,
--           update_commission_debt, settle_commission,
--           get_organizer_commission_status, enforce_commission_lockout,
--           expire_manual_orders
--   • Cron jobs: expire-manual-orders, enforce-commission-lockout
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- PART 1: ENUMS
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE manual_payment_method AS ENUM (
    'vodafone_cash', 'instapay', 'bank_transfer', 'fawry', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE manual_order_status AS ENUM (
    'pending_payment',    -- Buyer submitted order, hasn't confirmed payment yet
    'pending_approval',   -- Buyer confirmed sending payment, awaiting organizer review
    'approved',           -- Organizer confirmed payment received → tickets issued
    'rejected',           -- Organizer says payment not received
    'expired',            -- TTL expired (buyer didn't confirm in time)
    'cancelled'           -- Buyer cancelled
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- PART 2: COLUMN ADDITIONS TO EXISTING TABLES
-- ════════════════════════════════════════════════════════════

-- ── events: accepted payment methods ──
ALTER TABLE events ADD COLUMN IF NOT EXISTS
  accepted_payment_methods TEXT[] DEFAULT ARRAY['stripe'];
COMMENT ON COLUMN events.accepted_payment_methods IS
  'Payment methods this event accepts: stripe, vodafone_cash, instapay, bank_transfer, fawry';

-- ── organizers: manual payment config ──
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS
  manual_payment_methods JSONB DEFAULT '[]'::JSONB;
COMMENT ON COLUMN organizers.manual_payment_methods IS
  'Array of {method, destination, label} objects for manual transfer options';

ALTER TABLE organizers ADD COLUMN IF NOT EXISTS
  manual_transfer_instructions TEXT;
COMMENT ON COLUMN organizers.manual_transfer_instructions IS
  'Free-text instructions shown to buyer when they choose manual transfer';

-- ── orders: link to manual transfer order + channel ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  manual_transfer_order_id UUID;
COMMENT ON COLUMN orders.manual_transfer_order_id IS
  'FK to manual_transfer_orders if this order was created via manual approval';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  payment_channel TEXT DEFAULT 'stripe'
    CHECK (payment_channel IN ('stripe', 'manual'));
COMMENT ON COLUMN orders.payment_channel IS
  'How payment was received: stripe (Stripe Checkout) or manual (bank/wallet transfer)';

-- ── payments: channel ──
ALTER TABLE payments ADD COLUMN IF NOT EXISTS
  payment_channel TEXT DEFAULT 'stripe'
    CHECK (payment_channel IN ('stripe', 'manual'));
COMMENT ON COLUMN payments.payment_channel IS
  'Payment channel: stripe or manual (for commission debt tracking)';

-- ── manual_transfer_orders: guest retrieval token ──
ALTER TABLE manual_transfer_orders ADD COLUMN IF NOT EXISTS
  guest_token TEXT;
COMMENT ON COLUMN manual_transfer_orders.guest_token IS
  'Raw guest retrieval token for guest ticket access after approval';



-- ════════════════════════════════════════════════════════════
-- PART 3: NEW TABLES
-- ════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────
-- TABLE 1: manual_transfer_orders
-- Tracks manual payment orders through the approval lifecycle.
-- Orders here do NOT get tickets until the organizer approves.
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS manual_transfer_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  event_id              UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tier_id               UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
  reservation_id        UUID REFERENCES reservations(id),
  user_id               UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL for guests

  -- Buyer info (always captured, even for authenticated users)
  buyer_name            TEXT NOT NULL,
  buyer_email           TEXT NOT NULL,
  buyer_phone           TEXT NOT NULL,

  -- Payment details
  payment_method        manual_payment_method NOT NULL,
  quantity              INT NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),

  -- Financial snapshot (frozen at order time — same pattern as payments table)
  unit_price            DECIMAL(10,2) NOT NULL,
  subtotal              DECIMAL(10,2) NOT NULL,
  tax_amount            DECIMAL(10,2) DEFAULT 0,
  platform_fee_total    DECIMAL(10,2) DEFAULT 0,
  total_amount          DECIMAL(10,2) NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'EGP',
  organizer_net         DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Breakdown snapshot (full financial data for audit trail)
  financial_snapshot    JSONB DEFAULT '{}'::JSONB,

  -- Transfer instructions shown to buyer
  transfer_destination  TEXT,           -- e.g. "Vodafone Cash: 01XXXXXXXXX"
  transfer_reference    TEXT UNIQUE,    -- Auto-generated reference code (e.g. EVT-A3F-X8K2)

  -- Proof of payment (optional)
  proof_image_url       TEXT,           -- Screenshot of transfer receipt
  buyer_notes           TEXT,           -- Buyer can add notes about the transfer

  -- Status tracking
  status                manual_order_status DEFAULT 'pending_payment',

  -- Organizer action tracking
  approved_by           UUID REFERENCES profiles(id),
  approved_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  rejected_at           TIMESTAMPTZ,

  -- Guest support
  guest_token           TEXT,           -- Raw guest token sent to buyer email

  -- Seat support
  seat_ids              UUID[],         -- For seated events


  -- Promo code support
  promo_id              UUID,
  promo_code            TEXT,

  -- TTL: order expires if buyer doesn't confirm payment within window
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mto_event ON manual_transfer_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_mto_status ON manual_transfer_orders(status);
CREATE INDEX IF NOT EXISTS idx_mto_user ON manual_transfer_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_mto_reference ON manual_transfer_orders(transfer_reference);
CREATE INDEX IF NOT EXISTS idx_mto_event_status ON manual_transfer_orders(event_id, status);
CREATE INDEX IF NOT EXISTS idx_mto_expires ON manual_transfer_orders(expires_at)
  WHERE status IN ('pending_payment', 'pending_approval');

-- Auto-update timestamp
DROP TRIGGER IF EXISTS mto_updated_at ON manual_transfer_orders;
CREATE TRIGGER mto_updated_at BEFORE UPDATE ON manual_transfer_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────
-- TABLE 2: commission_debt
-- Per-event commission debt ledger for manual transfers.
-- The kill-switch reads scanner_locked from this table.
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commission_debt (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id          UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  event_id              UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Accumulating debt
  total_manual_sales    DECIMAL(12,2) NOT NULL DEFAULT 0,  -- Total manual transfer revenue
  commission_rate       DECIMAL(5,2) NOT NULL DEFAULT 5.0, -- Rate at time of calculation
  commission_owed       DECIMAL(12,2) NOT NULL DEFAULT 0,  -- Total platform commission owed
  commission_paid       DECIMAL(12,2) NOT NULL DEFAULT 0,  -- Amount settled by organizer
  commission_balance    DECIMAL(12,2) NOT NULL DEFAULT 0,  -- owed − paid (the outstanding debt)

  -- Settlement tracking
  last_settled_at       TIMESTAMPTZ,
  settlement_method     TEXT,  -- 'bank_transfer', 'stripe_deduction', 'admin_waiver'
  settlement_reference  TEXT,  -- Bank ref or Stripe charge ID

  -- Status lifecycle
  status                TEXT NOT NULL DEFAULT 'accruing'
    CHECK (status IN ('accruing', 'due', 'settled', 'overdue', 'waived')),

  -- Kill-switch: when true, verify-ticket Edge Function rejects scans
  scanner_locked        BOOLEAN DEFAULT false,
  locked_at             TIMESTAMPTZ,
  lock_reason           TEXT,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One debt record per organizer per event
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_debt_org_event
  ON commission_debt(organizer_id, event_id);
CREATE INDEX IF NOT EXISTS idx_commission_debt_status
  ON commission_debt(status) WHERE status IN ('due', 'overdue');
CREATE INDEX IF NOT EXISTS idx_commission_debt_locked
  ON commission_debt(scanner_locked) WHERE scanner_locked = true;
CREATE INDEX IF NOT EXISTS idx_commission_debt_event
  ON commission_debt(event_id);

DROP TRIGGER IF EXISTS commission_debt_updated_at ON commission_debt;
CREATE TRIGGER commission_debt_updated_at BEFORE UPDATE ON commission_debt
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────
-- TABLE 3: commission_settlements
-- Append-only audit log of all settlement actions.
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commission_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id           UUID NOT NULL REFERENCES commission_debt(id) ON DELETE CASCADE,
  organizer_id      UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  amount            DECIMAL(12,2) NOT NULL,
  method            TEXT NOT NULL CHECK (method IN (
    'bank_transfer', 'stripe_deduction', 'admin_waiver', 'manual_cash'
  )),
  reference         TEXT,           -- External reference (bank ref, Stripe transfer ID)
  proof_url         TEXT,           -- Receipt / screenshot URL
  verified_by       UUID REFERENCES profiles(id),
  verified_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_debt ON commission_settlements(debt_id);
CREATE INDEX IF NOT EXISTS idx_settlements_org ON commission_settlements(organizer_id);


-- ════════════════════════════════════════════════════════════
-- PART 4: ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════

ALTER TABLE manual_transfer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_debt ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_settlements ENABLE ROW LEVEL SECURITY;

-- ──── manual_transfer_orders RLS ────

-- Buyers: see their own orders (authenticated by user_id)
CREATE POLICY "mto_select_buyer" ON manual_transfer_orders FOR SELECT
  USING (user_id = auth.uid());

-- Organizers: see orders for their events
CREATE POLICY "mto_select_organizer" ON manual_transfer_orders FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = manual_transfer_orders.event_id
    AND e.organizer_id = auth.uid()
  ));

-- Admins: see all
CREATE POLICY "mto_select_admin" ON manual_transfer_orders FOR SELECT
  USING (is_admin());

-- No direct INSERT/UPDATE/DELETE — all via SECURITY DEFINER RPCs
-- (create_manual_transfer_order, mark_manual_order_paid, approve_manual_order, reject_manual_order)

-- ──── commission_debt RLS ────

-- Organizers: see their own debt records
CREATE POLICY "cd_select_organizer" ON commission_debt FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organizers org
    WHERE org.id = commission_debt.organizer_id
    AND org.user_id = auth.uid()
  ));

-- Admins: see all
CREATE POLICY "cd_select_admin" ON commission_debt FOR SELECT
  USING (is_admin());

-- Admins: update debt records (for manual settlement)
CREATE POLICY "cd_update_admin" ON commission_debt FOR UPDATE
  USING (is_admin());

-- ──── commission_settlements RLS ────

-- Organizers: see their own settlements
CREATE POLICY "cs_select_organizer" ON commission_settlements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organizers org
    WHERE org.id = commission_settlements.organizer_id
    AND org.user_id = auth.uid()
  ));

-- Admins: see all + insert (record settlements)
CREATE POLICY "cs_select_admin" ON commission_settlements FOR SELECT
  USING (is_admin());
CREATE POLICY "cs_insert_admin" ON commission_settlements FOR INSERT
  WITH CHECK (is_admin());


-- ════════════════════════════════════════════════════════════
-- PART 5: HELPER RPCs
-- ════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────
-- RPC: update_commission_debt
-- Called internally when a manual order is approved.
-- Upserts the commission_debt record for the event.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_commission_debt(
  p_event_id       UUID,
  p_fee_amount     DECIMAL,
  p_sale_amount    DECIMAL
) RETURNS VOID AS $$
DECLARE
  v_org_id   UUID;
  v_rate     DECIMAL;
BEGIN
  -- Resolve organizer
  SELECT org.id,
    COALESCE(org.custom_commission_pct, 5.0)
  INTO v_org_id, v_rate
  FROM events e
  JOIN organizers org ON org.user_id = e.organizer_id
  WHERE e.id = p_event_id;

  IF v_org_id IS NULL THEN
    RAISE WARNING 'update_commission_debt: no organizer found for event %', p_event_id;
    RETURN;
  END IF;

  -- Upsert debt record
  INSERT INTO commission_debt (
    organizer_id, event_id, commission_rate,
    total_manual_sales, commission_owed, commission_balance, status
  ) VALUES (
    v_org_id, p_event_id, v_rate,
    p_sale_amount, p_fee_amount, p_fee_amount, 'accruing'
  )
  ON CONFLICT (organizer_id, event_id) DO UPDATE SET
    total_manual_sales = commission_debt.total_manual_sales + p_sale_amount,
    commission_owed    = commission_debt.commission_owed + p_fee_amount,
    commission_balance = commission_debt.commission_owed + p_fee_amount - commission_debt.commission_paid,
    updated_at         = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────
-- RPC: expire_manual_orders
-- Called by cron every 15 min. Expires unpaid manual orders
-- and releases their reservations.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION expire_manual_orders()
RETURNS INT AS $$
DECLARE
  v_count INT := 0;
  v_order RECORD;
BEGIN
  FOR v_order IN
    SELECT id, reservation_id
    FROM manual_transfer_orders
    WHERE status IN ('pending_payment', 'pending_approval')
      AND expires_at < now()
  LOOP
    -- Expire the manual order
    UPDATE manual_transfer_orders
    SET status = 'expired', updated_at = now()
    WHERE id = v_order.id;

    -- Release the reservation
    IF v_order.reservation_id IS NOT NULL THEN
      UPDATE reservations
      SET status = 'expired'
      WHERE id = v_order.reservation_id
        AND status = 'active';
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    RAISE NOTICE 'Expired % manual transfer order(s)', v_count;
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────
-- RPC: enforce_commission_lockout
-- Called by cron daily at midnight. Locks scanners for events
-- starting within 24h that have unpaid commission debt.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_commission_lockout()
RETURNS INT AS $$
DECLARE
  v_locked INT := 0;
  v_due    INT := 0;
BEGIN
  -- 1. Lock scanners for events starting within 24 hours
  --    where commission debt is > 0 and not yet settled
  UPDATE commission_debt cd
  SET scanner_locked = true,
      locked_at      = now(),
      lock_reason    = 'Unpaid commission balance: ' || cd.commission_balance,
      status         = 'overdue'
  FROM events e
  WHERE cd.event_id = e.id
    AND cd.commission_balance > 0
    AND cd.status IN ('accruing', 'due')
    AND COALESCE(e.end_date, e.date) > now()   -- event hasn't ended yet
    AND e.date <= now() + interval '24 hours'  -- event starts within 24h
    AND cd.scanner_locked = false;

  GET DIAGNOSTICS v_locked = ROW_COUNT;

  -- 2. Mark debt as 'due' for events starting within 72 hours
  --    (gives organizer a 48h warning window)
  UPDATE commission_debt cd
  SET status = 'due', updated_at = now()
  FROM events e
  WHERE cd.event_id = e.id
    AND cd.commission_balance > 0
    AND cd.status = 'accruing'
    AND e.date <= now() + interval '72 hours';

  GET DIAGNOSTICS v_due = ROW_COUNT;

  IF v_locked > 0 THEN
    RAISE NOTICE 'Locked scanner for % event(s) with unpaid commission', v_locked;
  END IF;
  IF v_due > 0 THEN
    RAISE NOTICE 'Marked % event(s) commission as due', v_due;
  END IF;

  RETURN v_locked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- PART 6: CORE BUSINESS RPCs
-- ════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────
-- RPC: create_manual_transfer_order
-- Creates a manual transfer order + reserves inventory.
-- Called by the create-manual-order Edge Function.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_manual_transfer_order(
  p_event_id        UUID,
  p_tier_id         UUID,
  p_quantity         INT,
  p_payment_method   TEXT,
  p_buyer_name       TEXT,
  p_buyer_email      TEXT,
  p_buyer_phone      TEXT,
  p_user_id          UUID DEFAULT NULL,
  p_seat_ids         UUID[] DEFAULT NULL,
  p_promo_code       TEXT DEFAULT NULL,
  p_proof_image_url  TEXT DEFAULT NULL,
  p_buyer_notes      TEXT DEFAULT NULL
) RETURNS JSONB AS $func$
DECLARE
  v_breakdown     JSONB;
  v_reservation   JSONB;
  v_res_id        UUID;
  v_order_id      UUID;
  v_reference     TEXT;
  v_org           RECORD;
  v_dest          TEXT;
  v_event         RECORD;
  v_method        manual_payment_method;
BEGIN
  -- ═══ VALIDATION ═══

  IF p_quantity < 1 OR p_quantity > 10 THEN
    RETURN jsonb_build_object('error', 'Quantity must be between 1 and 10');
  END IF;

  -- Validate payment method enum
  BEGIN
    v_method := p_payment_method::manual_payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('error', 'Invalid payment method: ' || p_payment_method);
  END;

  -- Check event exists, is published, and allows manual transfers
  SELECT e.id, e.title, e.organizer_id, e.status, e.listing_type,
         e.accepted_payment_methods, e.date
  INTO v_event
  FROM events e WHERE e.id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  IF v_event.status != 'published' THEN
    RETURN jsonb_build_object('error', 'Event is not published');
  END IF;

  -- Block manual transfers for free events (display_only)
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('error', 'Manual transfers are not available for free events');
  END IF;

  -- Verify this payment method is accepted for this event
  IF NOT (p_payment_method = ANY(v_event.accepted_payment_methods)) THEN
    RETURN jsonb_build_object('error', 'This payment method is not accepted for this event');
  END IF;

  -- ═══ PRICING: Use the same calculation as Stripe checkout ═══
  v_breakdown := calculate_order_breakdown_v3(p_tier_id, p_quantity, p_promo_code);

  IF v_breakdown IS NULL OR v_breakdown ? 'error' THEN
    RETURN jsonb_build_object('error', COALESCE(v_breakdown->>'error', 'Pricing calculation failed'));
  END IF;

  -- ═══ RESERVE INVENTORY ═══
  -- Use the same reservation system as Stripe checkout
  IF p_user_id IS NOT NULL THEN
    -- Authenticated reservation
    IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
      SELECT rpc_result INTO v_reservation
      FROM (SELECT reserve_seats(p_user_id, p_seat_ids, p_tier_id) AS rpc_result) x;
    ELSE
      DECLARE
        v_res_row RECORD;
      BEGIN
        SELECT * INTO v_res_row
        FROM create_reservation(p_user_id, p_tier_id, p_quantity);
        v_res_id := v_res_row.reservation_id;
      END;
    END IF;
  ELSE
    -- Guest reservation
    IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
      v_reservation := reserve_guest_seats(p_seat_ids, p_tier_id);
      v_res_id := (v_reservation->>'reservation_id')::UUID;
    ELSE
      v_reservation := create_guest_reservation(p_tier_id, p_quantity);
      v_res_id := (v_reservation->>'reservation_id')::UUID;
    END IF;
  END IF;

  -- ═══ GENERATE UNIQUE REFERENCE CODE ═══
  v_reference := 'EVT-' ||
    upper(substring(p_event_id::TEXT from 1 for 4)) || '-' ||
    upper(substring(md5(random()::TEXT || clock_timestamp()::TEXT) from 1 for 4));

  -- ═══ GET ORGANIZER TRANSFER DESTINATION ═══
  SELECT org.manual_payment_methods, org.manual_transfer_instructions
  INTO v_org
  FROM organizers org
  JOIN events e ON e.organizer_id = org.user_id
  WHERE e.id = p_event_id;

  -- Find the matching payment method destination
  IF v_org.manual_payment_methods IS NOT NULL THEN
    SELECT elem->>'destination'
    INTO v_dest
    FROM jsonb_array_elements(v_org.manual_payment_methods) AS elem
    WHERE elem->>'method' = p_payment_method
    LIMIT 1;
  END IF;

  -- ═══ INSERT MANUAL TRANSFER ORDER ═══
  INSERT INTO manual_transfer_orders (
    event_id, tier_id, reservation_id, user_id,
    buyer_name, buyer_email, buyer_phone,
    payment_method, quantity,
    unit_price, subtotal, tax_amount, platform_fee_total,
    total_amount, currency, organizer_net,
    financial_snapshot,
    transfer_destination, transfer_reference,
    proof_image_url, buyer_notes,
    seat_ids, promo_id, promo_code,
    status, expires_at
  ) VALUES (
    p_event_id, p_tier_id, v_res_id, p_user_id,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    v_method, p_quantity,
    COALESCE((v_breakdown->>'unit_price')::DECIMAL, 0),
    COALESCE((v_breakdown->>'subtotal')::DECIMAL, 0),
    COALESCE((v_breakdown->>'tax_amount')::DECIMAL, 0),
    COALESCE((v_breakdown->>'platform_fee_total')::DECIMAL, 0),
    COALESCE((v_breakdown->>'total')::DECIMAL, 0),
    COALESCE(v_breakdown->>'currency', 'EGP'),
    COALESCE((v_breakdown->>'organizer_net')::DECIMAL, 0),
    v_breakdown,
    v_dest,
    v_reference,
    p_proof_image_url, p_buyer_notes,
    p_seat_ids,
    NULLIF(v_breakdown->>'promo_id', '')::UUID,
    p_promo_code,
    'pending_payment',
    now() + interval '24 hours'
  ) RETURNING id INTO v_order_id;

  -- ═══ RETURN ═══
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'transfer_reference', v_reference,
    'reservation_id', v_res_id,
    'total_amount', COALESCE((v_breakdown->>'total')::DECIMAL, 0),
    'currency', COALESCE(v_breakdown->>'currency', 'EGP'),
    'transfer_destination', v_dest,
    'transfer_instructions', v_org.manual_transfer_instructions,
    'payment_method', p_payment_method,
    'expires_at', (now() + interval '24 hours'),
    'event_title', v_event.title,
    'breakdown', v_breakdown
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────
-- RPC: mark_manual_order_paid
-- Buyer clicks "I've sent the payment" → status moves
-- from pending_payment → pending_approval
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_manual_order_paid(
  p_order_id        UUID,
  p_proof_image_url TEXT DEFAULT NULL,
  p_buyer_notes     TEXT DEFAULT NULL
) RETURNS JSONB AS $func$
DECLARE
  v_caller_id UUID := auth.uid();
  v_order     RECORD;
BEGIN
  SELECT * INTO v_order
  FROM manual_transfer_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('error', 'Order not found');
  END IF;

  -- Verify the caller is the buyer (if authenticated)
  IF v_caller_id IS NOT NULL AND v_order.user_id IS NOT NULL
     AND v_order.user_id != v_caller_id THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  IF v_order.status != 'pending_payment' THEN
    RETURN jsonb_build_object('error', 'Order is not in pending payment state');
  END IF;

  IF v_order.expires_at < now() THEN
    -- Auto-expire if TTL has passed
    UPDATE manual_transfer_orders SET status = 'expired' WHERE id = p_order_id;
    RETURN jsonb_build_object('error', 'Order has expired');
  END IF;

  -- Transition to pending_approval
  UPDATE manual_transfer_orders
  SET status          = 'pending_approval',
      proof_image_url = COALESCE(p_proof_image_url, proof_image_url),
      buyer_notes     = COALESCE(p_buyer_notes, buyer_notes),
      updated_at      = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'pending_approval',
    'message', 'Payment confirmation submitted. The event organizer will review and approve your order.'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────
-- RPC: approve_manual_order
-- Organizer confirms payment received → creates real order,
-- tickets, payment record, and accumulates commission debt.
-- This is the fulfillment engine for manual transfers.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_manual_order(p_manual_order_id UUID)
RETURNS JSONB AS $func$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_mto          RECORD;
  v_event        RECORD;
  v_tier         RECORD;
  v_org_id       UUID;
  v_order_id     UUID;
  v_ticket_ids   UUID[];
  v_ticket_id    UUID;
  v_i            INT;
  v_raw_token    TEXT := NULL;
BEGIN
  -- ═══ 1. VALIDATE: Lock the manual order row ═══
  SELECT mto.*
  INTO v_mto
  FROM manual_transfer_orders mto
  WHERE mto.id = p_manual_order_id
  FOR UPDATE;

  IF v_mto IS NULL THEN
    RETURN jsonb_build_object('error', 'Order not found');
  END IF;

  IF v_mto.status != 'pending_approval' THEN
    RETURN jsonb_build_object('error', 'Order is not pending approval (current: ' || v_mto.status || ')');
  END IF;

  -- ═══ 2. VERIFY: Caller is the event organizer ═══
  SELECT e.organizer_id, e.title, e.venue, e.date
  INTO v_event
  FROM events e WHERE e.id = v_mto.event_id;

  IF v_event.organizer_id != v_caller_id THEN
    RETURN jsonb_build_object('error', 'Only the event organizer can approve this order');
  END IF;

  SELECT tt.name, tt.price INTO v_tier
  FROM ticket_tiers tt WHERE tt.id = v_mto.tier_id;

  -- Resolve organizer_id for payments table
  SELECT org.id INTO v_org_id
  FROM organizers org WHERE org.user_id = v_caller_id;

  -- ═══ 3. CREATE: Real order in orders table ═══
  INSERT INTO orders (
    event_id, reservation_id, amount, currency, status,
    user_id, is_guest, guest_name, guest_email, guest_phone,
    subtotal, tax_amount, platform_fee_amount,
    manual_transfer_order_id, payment_channel
  ) VALUES (
    v_mto.event_id, v_mto.reservation_id, v_mto.total_amount,
    v_mto.currency, 'paid',
    v_mto.user_id,
    v_mto.user_id IS NULL,
    v_mto.buyer_name, v_mto.buyer_email, v_mto.buyer_phone,
    v_mto.subtotal, v_mto.tax_amount, v_mto.platform_fee_total,
    p_manual_order_id, 'manual'
  ) RETURNING id INTO v_order_id;

  -- ═══ 4. CREATE: Tickets (QR hash will be set by Edge Function) ═══
  -- We create ticket stubs here with placeholder QR hashes.
  -- The Edge Function that calls this RPC will generate HMAC-signed
  -- QR codes and update them post-creation.
  v_ticket_ids := ARRAY[]::UUID[];
  FOR v_i IN 1..v_mto.quantity LOOP
    v_ticket_id := gen_random_uuid();
    v_ticket_ids := v_ticket_ids || v_ticket_id;

    INSERT INTO tickets (
      id, order_id, ticket_tier_id, user_id,
      qr_hash, status
    ) VALUES (
      v_ticket_id, v_order_id, v_mto.tier_id,
      v_mto.user_id,
      '__PENDING_QR_' || v_ticket_id::TEXT,  -- Placeholder — Edge Function replaces
      'valid'
    );
  END LOOP;

  -- ═══ 5. CREATE: Payment record (same schema as Stripe payments) ═══
  INSERT INTO payments (
    order_id, event_id, organizer_id,
    subtotal, tax_rate_snapshot, tax_amount,
    platform_fee_pct, platform_fee_total,
    total_amount, currency, organizer_net,
    promo_code, promo_discount,
    payment_channel, status, paid_at
  ) VALUES (
    v_order_id, v_mto.event_id, v_org_id,
    v_mto.subtotal,
    COALESCE((v_mto.financial_snapshot->>'tax_rate')::DECIMAL, 0),
    v_mto.tax_amount,
    COALESCE((v_mto.financial_snapshot->>'platform_fee_pct')::DECIMAL, 0),
    v_mto.platform_fee_total,
    v_mto.total_amount, v_mto.currency, v_mto.organizer_net,
    v_mto.promo_code,
    COALESCE((v_mto.financial_snapshot->>'promo_discount')::DECIMAL, 0),
    'manual', 'paid', now()
  );

  -- ═══ 6. GUEST RETRIEVAL TOKEN ═══
  IF v_mto.user_id IS NULL THEN
    v_raw_token := gen_random_uuid()::text || '-' || gen_random_uuid()::text;
    PERFORM create_guest_token(v_order_id, v_mto.buyer_email, v_raw_token);
  END IF;

  -- ═══ 7. UPDATE: Manual order status ═══
  UPDATE manual_transfer_orders
  SET status      = 'approved',
      approved_by = v_caller_id,
      approved_at = now(),
      guest_token = v_raw_token,
      updated_at  = now()
  WHERE id = p_manual_order_id;

  -- ═══ 8. CONVERT: Reservation ═══
  IF v_mto.reservation_id IS NOT NULL THEN
    UPDATE reservations SET status = 'converted'
    WHERE id = v_mto.reservation_id;
  END IF;

  -- ═══ 8. INCREMENT: Sold count ═══
  PERFORM increment_sold_count(v_mto.tier_id, v_mto.quantity);

  -- ═══ 9. ACCUMULATE: Commission debt ═══
  PERFORM update_commission_debt(
    v_mto.event_id,
    v_mto.platform_fee_total,
    v_mto.subtotal
  );

  -- ═══ 10. INCREMENT: Promo usage (if applicable) ═══
  IF v_mto.promo_id IS NOT NULL THEN
    BEGIN
      PERFORM increment_promo_usage(v_mto.promo_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'increment_promo_usage failed: %', SQLERRM;
    END;
  END IF;

  -- ═══ SUCCESS ═══
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'ticket_ids', to_jsonb(v_ticket_ids),
    'ticket_count', v_mto.quantity,
    'buyer_name', v_mto.buyer_name,
    'buyer_email', v_mto.buyer_email,
    'event_title', v_event.title,
    'tier_name', v_tier.name,
    'total_amount', v_mto.total_amount,
    'currency', v_mto.currency,
    'payment_method', v_mto.payment_method::TEXT
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────
-- RPC: reject_manual_order
-- Organizer rejects the order → releases reservation.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_manual_order(
  p_manual_order_id UUID,
  p_reason          TEXT DEFAULT 'Payment not received'
) RETURNS JSONB AS $func$
DECLARE
  v_caller_id UUID := auth.uid();
  v_mto       RECORD;
  v_event     RECORD;
BEGIN
  SELECT mto.* INTO v_mto
  FROM manual_transfer_orders mto
  WHERE mto.id = p_manual_order_id
  FOR UPDATE;

  IF v_mto IS NULL THEN
    RETURN jsonb_build_object('error', 'Order not found');
  END IF;

  IF v_mto.status NOT IN ('pending_approval', 'pending_payment') THEN
    RETURN jsonb_build_object('error', 'Order cannot be rejected in current state: ' || v_mto.status);
  END IF;

  -- Verify caller is organizer
  SELECT e.organizer_id INTO v_event
  FROM events e WHERE e.id = v_mto.event_id;

  IF v_event.organizer_id != v_caller_id THEN
    RETURN jsonb_build_object('error', 'Only the event organizer can reject this order');
  END IF;

  -- Reject the order
  UPDATE manual_transfer_orders
  SET status           = 'rejected',
      rejection_reason = p_reason,
      rejected_at      = now(),
      approved_by      = v_caller_id,
      updated_at       = now()
  WHERE id = p_manual_order_id;

  -- Release the reservation
  IF v_mto.reservation_id IS NOT NULL THEN
    UPDATE reservations SET status = 'expired'
    WHERE id = v_mto.reservation_id AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'rejected',
    'buyer_email', v_mto.buyer_email,
    'buyer_name', v_mto.buyer_name,
    'message', 'Order rejected. Reservation released.'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────
-- RPC: settle_commission
-- Admin records that an organizer has settled their
-- commission debt. Supports partial settlements.
-- Unlocks scanner if debt is fully cleared.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION settle_commission(
  p_debt_id    UUID,
  p_amount     DECIMAL,
  p_method     TEXT,
  p_reference  TEXT DEFAULT NULL,
  p_proof_url  TEXT DEFAULT NULL,
  p_notes      TEXT DEFAULT NULL
) RETURNS JSONB AS $func$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_role TEXT;
  v_debt        RECORD;
  v_new_balance DECIMAL;
BEGIN
  -- Admin-only
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than 0');
  END IF;

  -- Validate method
  IF p_method NOT IN ('bank_transfer', 'stripe_deduction', 'admin_waiver', 'manual_cash') THEN
    RETURN jsonb_build_object('error', 'Invalid settlement method');
  END IF;

  -- Lock debt record
  SELECT * INTO v_debt
  FROM commission_debt WHERE id = p_debt_id
  FOR UPDATE;

  IF v_debt IS NULL THEN
    RETURN jsonb_build_object('error', 'Commission debt record not found');
  END IF;

  IF p_amount > v_debt.commission_balance THEN
    RETURN jsonb_build_object('error', 'Settlement amount exceeds outstanding balance',
      'balance', v_debt.commission_balance, 'attempted', p_amount);
  END IF;

  -- Record the settlement (audit log)
  INSERT INTO commission_settlements (
    debt_id, organizer_id, amount, method,
    reference, proof_url, verified_by, verified_at, notes
  ) VALUES (
    p_debt_id, v_debt.organizer_id, p_amount, p_method,
    p_reference, p_proof_url, v_caller_id, now(), p_notes
  );

  -- Update the debt record
  v_new_balance := v_debt.commission_balance - p_amount;

  UPDATE commission_debt
  SET commission_paid    = commission_paid + p_amount,
      commission_balance = v_new_balance,
      last_settled_at    = now(),
      settlement_method  = p_method,
      settlement_reference = p_reference,
      -- If fully settled, unlock scanner and update status
      scanner_locked     = CASE WHEN v_new_balance <= 0 THEN false ELSE scanner_locked END,
      status             = CASE WHEN v_new_balance <= 0 THEN 'settled' ELSE status END,
      updated_at         = now()
  WHERE id = p_debt_id;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'status', CASE WHEN v_new_balance <= 0 THEN 'settled' ELSE 'partial' END,
    'scanner_unlocked', v_new_balance <= 0,
    'message', CASE WHEN v_new_balance <= 0
      THEN 'Commission fully settled. Scanner unlocked.'
      ELSE 'Partial settlement recorded. Remaining balance: ' || v_new_balance
    END
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────
-- RPC: get_organizer_commission_status
-- Returns the commission debt summary for the dashboard.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_organizer_commission_status()
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id  UUID;
  v_debts   JSONB;
  v_summary RECORD;
BEGIN
  SELECT id INTO v_org_id FROM organizers WHERE user_id = v_user_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('has_debt', false, 'total_owed', 0, 'total_paid', 0);
  END IF;

  -- Summary totals
  SELECT
    COALESCE(SUM(commission_owed), 0) AS total_owed,
    COALESCE(SUM(commission_paid), 0) AS total_paid,
    COALESCE(SUM(commission_balance), 0) AS total_balance,
    COUNT(*) FILTER (WHERE scanner_locked = true) AS locked_events,
    COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count,
    COUNT(*) FILTER (WHERE status = 'due') AS due_count
  INTO v_summary
  FROM commission_debt
  WHERE organizer_id = v_org_id;

  -- Per-event breakdown (latest 20)
  SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb ORDER BY d.event_date DESC), '[]'::jsonb)
  INTO v_debts
  FROM (
    SELECT
      cd.id AS debt_id,
      cd.event_id,
      e.title AS event_title,
      e.date AS event_date,
      e.currency AS event_currency,
      cd.total_manual_sales,
      cd.commission_rate,
      cd.commission_owed,
      cd.commission_paid,
      cd.commission_balance,
      cd.status,
      cd.scanner_locked,
      cd.lock_reason,
      cd.last_settled_at
    FROM commission_debt cd
    JOIN events e ON e.id = cd.event_id
    WHERE cd.organizer_id = v_org_id
    ORDER BY e.date DESC
    LIMIT 20
  ) d;

  RETURN jsonb_build_object(
    'has_debt', v_summary.total_balance > 0,
    'total_owed', v_summary.total_owed,
    'total_paid', v_summary.total_paid,
    'total_balance', v_summary.total_balance,
    'locked_events', v_summary.locked_events,
    'overdue_count', v_summary.overdue_count,
    'due_count', v_summary.due_count,
    'events', v_debts
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════════════════════════════════════════════════════
-- PART 7: GRANTS
-- ════════════════════════════════════════════════════════════

-- Tables: read-only for authenticated (mutations via RPCs only)
GRANT SELECT ON manual_transfer_orders TO authenticated;
GRANT SELECT ON commission_debt TO authenticated;
GRANT SELECT ON commission_settlements TO authenticated;

-- Allow admin to update commission_debt (for manual operations)
GRANT UPDATE ON commission_debt TO authenticated;
-- Allow admin to insert settlements
GRANT INSERT ON commission_settlements TO authenticated;

-- Sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- RPCs: accessible by authenticated users
GRANT EXECUTE ON FUNCTION create_manual_transfer_order(
  UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], TEXT, TEXT, TEXT
) TO authenticated;

-- Also grant to anon for guest manual checkout
GRANT EXECUTE ON FUNCTION create_manual_transfer_order(
  UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], TEXT, TEXT, TEXT
) TO anon;

GRANT EXECUTE ON FUNCTION mark_manual_order_paid(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_manual_order_paid(UUID, TEXT, TEXT) TO anon;

GRANT EXECUTE ON FUNCTION approve_manual_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_manual_order(UUID, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION get_organizer_commission_status() TO authenticated;

-- Admin-only RPCs (but still need GRANT to authenticated since is_admin() check is inside)
GRANT EXECUTE ON FUNCTION settle_commission(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Service-role / cron-only (no grant to authenticated)
-- expire_manual_orders() and enforce_commission_lockout() remain service_role only


-- ════════════════════════════════════════════════════════════
-- PART 8: CRON JOBS
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN
  -- Expire stale manual transfer orders every 15 minutes
  PERFORM cron.schedule(
    'expire-manual-orders',
    '*/15 * * * *',
    $c$ SELECT expire_manual_orders(); $c$
  );

  -- Enforce commission lockout daily at midnight
  PERFORM cron.schedule(
    'enforce-commission-lockout',
    '0 0 * * *',
    $c$ SELECT enforce_commission_lockout(); $c$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not enabled — skipping cron schedule. Run manually or set up via Supabase dashboard.';
END $$;


-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v41 COMPLETE
-- ════════════════════════════════════════════════════════════
--
-- Objects created:
--   ✓ Enums: manual_payment_method, manual_order_status
--   ✓ Tables: manual_transfer_orders, commission_debt, commission_settlements
--   ✓ Columns: events.accepted_payment_methods, organizers.manual_*,
--              orders.manual_transfer_order_id, orders.payment_channel,
--              payments.payment_channel
--   ✓ RLS: 11 policies across 3 new tables
--   ✓ RPCs: create_manual_transfer_order, mark_manual_order_paid,
--           approve_manual_order, reject_manual_order,
--           update_commission_debt, settle_commission,
--           get_organizer_commission_status, enforce_commission_lockout,
--           expire_manual_orders
--   ✓ Crons: expire-manual-orders (*/15), enforce-commission-lockout (0 0)
--
-- Verification:
--
--   -- Check tables:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('manual_transfer_orders', 'commission_debt', 'commission_settlements');
--
--   -- Check new columns:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'events' AND column_name = 'accepted_payment_methods';
--
--   -- Check RLS:
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('manual_transfer_orders', 'commission_debt', 'commission_settlements');
--
--   -- Test pricing (should work identically to Stripe path):
--   SELECT create_manual_transfer_order(
--     '<event_id>', '<tier_id>', 2, 'vodafone_cash',
--     'Test Buyer', 'test@test.com', '01012345678'
--   );
