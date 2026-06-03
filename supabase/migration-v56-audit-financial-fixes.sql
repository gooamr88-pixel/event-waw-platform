-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v56: Financial Audit Fixes
-- Date: 2026-06-03
--
-- Fixes three bugs identified in the financial audit:
--
--   C-1  (Critical) Hardcoded EGP/USD exchange rate of 50.0
--        in request_payout auto-deduction engine.
--        → New table platform_exchange_rates + helper function
--          get_exchange_rate(from, to). Falls back to 50.0 with
--          a WARNING if no rate is configured.
--
--   C-3 / H17  (High) Commission debt balance drift under
--        concurrent upserts in update_commission_debt.
--        → Adds FOR UPDATE lock before the upsert and uses
--          EXCLUDED values for correct balance calculation.
--
--   M-8  (Medium) Transfer reference too short — only 4 random
--        hex chars (65 K values) in create_manual_transfer_order.
--        → Increased to 12 hex chars (281 trillion values).
--
-- ⚠️ SAFE TO RUN: Replaces functions only + additive table.
--    No data loss. Idempotent.
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- FIX C-1 PART A: Exchange Rate Table + Helper
-- ════════════════════════════════════════════════════════════

-- Table to store configurable exchange rates.
-- Admins can INSERT/UPDATE rows via the Supabase dashboard or
-- an admin RPC. The app reads via get_exchange_rate().
CREATE TABLE IF NOT EXISTS platform_exchange_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency   TEXT NOT NULL,
  to_currency     TEXT NOT NULL,
  rate            DECIMAL(14,6) NOT NULL CHECK (rate > 0),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT,
  updated_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active rate per currency pair at a time.
-- If you need historical rates, archive old rows before inserting.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_rates_pair
  ON platform_exchange_rates(from_currency, to_currency);

COMMENT ON TABLE platform_exchange_rates IS
  'Configurable exchange rates for cross-currency commission deductions. '
  'Replaces the hardcoded 50.0 EGP/USD rate in request_payout.';

-- Seed with the current default rate so existing behaviour is preserved.
-- ON CONFLICT keeps the row idempotent across re-runs.
INSERT INTO platform_exchange_rates (from_currency, to_currency, rate, notes)
VALUES ('USD', 'EGP', 50.000000, 'Default seed rate — update to market rate')
ON CONFLICT (from_currency, to_currency) DO NOTHING;


-- Helper function: returns the rate for a given currency pair.
-- Falls back to 50.0 with a WARNING if no row exists.
CREATE OR REPLACE FUNCTION get_exchange_rate(
  p_from_currency TEXT,
  p_to_currency   TEXT
) RETURNS DECIMAL AS $$
DECLARE
  v_rate DECIMAL(14,6);
BEGIN
  SELECT rate INTO v_rate
  FROM platform_exchange_rates
  WHERE from_currency = upper(trim(p_from_currency))
    AND to_currency   = upper(trim(p_to_currency))
  LIMIT 1;

  IF v_rate IS NULL THEN
    -- Reverse lookup: if someone asks for EGP→USD but only USD→EGP exists
    SELECT 1.0 / rate INTO v_rate
    FROM platform_exchange_rates
    WHERE from_currency = upper(trim(p_to_currency))
      AND to_currency   = upper(trim(p_from_currency))
    LIMIT 1;
  END IF;

  IF v_rate IS NULL THEN
    RAISE WARNING 'get_exchange_rate: no rate found for %→%. Falling back to 50.0',
      p_from_currency, p_to_currency;
    v_rate := 50.0;
  END IF;

  RETURN v_rate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════════════════════════════════════════════════════
-- FIX C-1 PART B: Patched request_payout
-- Replaces every hardcoded `50.0` with dynamic rate from
-- get_exchange_rate('USD', 'EGP').
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION request_payout(p_amount DECIMAL)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_org RECORD;
  v_payout_dest TEXT;
  v_currency TEXT := 'USD';

  v_net_revenue DECIMAL(12,2) := 0;
  v_refunded DECIMAL(12,2) := 0;
  v_pending_balance DECIMAL(12,2) := 0;
  v_available_gross DECIMAL(12,2) := 0;
  v_total_paid DECIMAL(12,2) := 0;
  v_total_requested DECIMAL(12,2) := 0;
  v_available_balance DECIMAL(12,2) := 0;
  v_escrow_cutoff TIMESTAMPTZ := now() - interval '3 days';
  v_payout_id UUID;

  -- Auto-deduction engine variables
  v_remaining_payout_amount DECIMAL(12,2) := p_amount;
  v_total_deducted DECIMAL(12,2) := 0;
  v_deduct_amount DECIMAL(12,2);
  v_debt RECORD;

  -- C-1 FIX: dynamic exchange rate (replaces hardcoded 50.0)
  v_egp_usd_rate DECIMAL(14,6);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than 0');
  END IF;
  IF p_amount != ROUND(p_amount, 2) THEN
    RETURN jsonb_build_object('error', 'Amount must have at most 2 decimal places');
  END IF;

  -- Lock organizer row
  SELECT * INTO v_org FROM organizers WHERE user_id = v_user_id FOR UPDATE;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('error', 'No organizer profile found. Complete your profile first.');
  END IF;

  -- ══ PAYOUT METHOD VALIDATION ══
  IF v_org.payout_method = 'stripe_connect' THEN
    IF v_org.stripe_account_id IS NULL OR v_org.stripe_onboarding_complete IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'error', 'Your Stripe Connect account is not fully verified. Complete onboarding in Settings → Payment Setup.'
      );
    END IF;
  ELSIF v_org.payout_method = 'bank' THEN
    IF v_org.bank_account_number IS NULL OR v_org.bank_account_holder IS NULL THEN
      RETURN jsonb_build_object(
        'error', 'Please complete your bank account details before requesting a payout.'
      );
    END IF;
  ELSIF v_org.payout_method = 'paypal' THEN
    IF v_org.paypal_email IS NULL THEN
      RETURN jsonb_build_object(
        'error', 'Please add your PayPal email before requesting a payout.'
      );
    END IF;
  END IF;

  -- ══ CALCULATE AVAILABLE BALANCE ══
  SELECT COALESCE(SUM(p.organizer_net), 0), COALESCE(MAX(p.currency), 'USD')
  INTO v_net_revenue, v_currency
  FROM payments p WHERE p.organizer_id = v_org.id AND p.status = 'paid';

  SELECT COALESCE(SUM(p.organizer_net), 0) INTO v_refunded
  FROM payments p WHERE p.organizer_id = v_org.id AND p.status IN ('refunded', 'partially_refunded');

  v_net_revenue := v_net_revenue - v_refunded;
  IF v_net_revenue < 0 THEN v_net_revenue := 0; END IF;

  SELECT COALESCE(SUM(p.organizer_net), 0) INTO v_pending_balance
  FROM payments p JOIN events e ON e.id = p.event_id
  WHERE p.organizer_id = v_org.id AND p.status = 'paid'
    AND COALESCE(e.end_date, e.date) > v_escrow_cutoff;

  v_available_gross := v_net_revenue - v_pending_balance;
  IF v_available_gross < 0 THEN v_available_gross := 0; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN po.status = 'completed' THEN po.net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN po.status IN ('pending', 'processing') THEN po.net_amount ELSE 0 END), 0)
  INTO v_total_paid, v_total_requested
  FROM payouts po WHERE po.organizer_id = v_org.id;

  v_available_balance := v_available_gross - v_total_paid - v_total_requested;
  IF v_available_balance < 0 THEN v_available_balance := 0; END IF;

  IF p_amount > v_available_balance THEN
    RETURN jsonb_build_object(
      'error', 'Insufficient available balance',
      'requested', p_amount, 'available', v_available_balance
    );
  END IF;

  -- Build destination label
  v_payout_dest := CASE
    WHEN v_org.payout_method = 'bank' THEN 'Bank •••' || RIGHT(COALESCE(v_org.bank_account_number, ''), 4)
    WHEN v_org.payout_method = 'paypal' THEN COALESCE(v_org.paypal_email, '')
    WHEN v_org.payout_method = 'stripe_connect' THEN COALESCE(v_org.stripe_account_id, '')
    ELSE 'Unknown'
  END;

  -- ══ AUTO-DEDUCTION ENGINE ══
  -- C-1 FIX: fetch the dynamic exchange rate once before the loop
  v_egp_usd_rate := get_exchange_rate('USD', 'EGP');

  v_payout_id := gen_random_uuid();

  FOR v_debt IN
    SELECT cd.id, cd.commission_balance, e.currency AS event_currency
    FROM commission_debt cd
    JOIN events e ON e.id = cd.event_id
    WHERE cd.organizer_id = v_org.id
      AND cd.commission_balance > 0
      AND cd.status IN ('accruing', 'due', 'overdue')
    ORDER BY cd.created_at ASC
  LOOP
    IF v_remaining_payout_amount <= 0 THEN
      EXIT;
    END IF;

    -- Adjust EGP debt to payout currency using dynamic rate
    IF v_currency = 'USD' AND COALESCE(v_debt.event_currency, 'EGP') = 'EGP' THEN
      -- C-1 FIX: was ROUND(v_debt.commission_balance / 50.0, 2)
      v_deduct_amount := LEAST(v_remaining_payout_amount, ROUND(v_debt.commission_balance / v_egp_usd_rate, 2));

      IF v_deduct_amount > 0 THEN
        v_remaining_payout_amount := v_remaining_payout_amount - v_deduct_amount;
        v_total_deducted := v_total_deducted + v_deduct_amount;

        -- Record settlement in EGP (usd * rate)
        -- C-1 FIX: was ROUND(v_deduct_amount * 50.0, 2)
        INSERT INTO commission_settlements (
          debt_id, organizer_id, amount, method,
          reference, verified_at, notes
        ) VALUES (
          v_debt.id, v_org.id, ROUND(v_deduct_amount * v_egp_usd_rate, 2), 'stripe_deduction',
          'auto_payout_deduction_' || v_payout_id::text, now(),
          'Auto-deducted from Stripe payout ' || v_payout_id::text || ' ($' || v_deduct_amount || ' converted to EGP at rate ' || v_egp_usd_rate || ')'
        );

        -- Update debt record
        -- C-1 FIX: was ROUND(v_deduct_amount * 50.0, 2) in all lines below
        UPDATE commission_debt
        SET commission_paid    = commission_paid + ROUND(v_deduct_amount * v_egp_usd_rate, 2),
            commission_balance = commission_balance - ROUND(v_deduct_amount * v_egp_usd_rate, 2),
            last_settled_at    = now(),
            settlement_method  = 'stripe_deduction',
            settlement_reference = 'auto_payout_deduction_' || v_payout_id::text,
            scanner_locked     = CASE WHEN commission_balance - ROUND(v_deduct_amount * v_egp_usd_rate, 2) <= 0 THEN false ELSE scanner_locked END,
            status             = CASE WHEN commission_balance - ROUND(v_deduct_amount * v_egp_usd_rate, 2) <= 0 THEN 'settled' ELSE status END,
            updated_at         = now()
        WHERE id = v_debt.id;
      END IF;
    ELSE
      -- Payout currency matches debt currency (EGP to EGP or standard 1:1)
      v_deduct_amount := LEAST(v_remaining_payout_amount, v_debt.commission_balance);

      IF v_deduct_amount > 0 THEN
        v_remaining_payout_amount := v_remaining_payout_amount - v_deduct_amount;
        v_total_deducted := v_total_deducted + v_deduct_amount;

        -- Record settlement
        INSERT INTO commission_settlements (
          debt_id, organizer_id, amount, method,
          reference, verified_at, notes
        ) VALUES (
          v_debt.id, v_org.id, v_deduct_amount, 'stripe_deduction',
          'auto_payout_deduction_' || v_payout_id::text, now(),
          'Auto-deducted from Stripe payout ' || v_payout_id::text
        );

        -- Update debt record
        UPDATE commission_debt
        SET commission_paid    = commission_paid + v_deduct_amount,
            commission_balance = commission_balance - v_deduct_amount,
            last_settled_at    = now(),
            settlement_method  = 'stripe_deduction',
            settlement_reference = 'auto_payout_deduction_' || v_payout_id::text,
            scanner_locked     = CASE WHEN commission_balance - v_deduct_amount <= 0 THEN false ELSE scanner_locked END,
            status             = CASE WHEN commission_balance - v_deduct_amount <= 0 THEN 'settled' ELSE status END,
            updated_at         = now()
        WHERE id = v_debt.id;
      END IF;
    END IF;
  END LOOP;

  -- ══ CREATE PAYOUT REQUEST ══
  INSERT INTO payouts (
    id, organizer_id, gross_amount, platform_fees, tax_collected,
    net_amount, currency, payout_method, payout_destination,
    status, requested_at
  ) VALUES (
    v_payout_id, v_org.id, p_amount, v_total_deducted, 0,
    v_remaining_payout_amount, v_currency, v_org.payout_method, v_payout_dest,
    'pending', now()
  );

  RETURN jsonb_build_object(
    'success', true, 'payout_id', v_payout_id,
    'amount', p_amount, 'currency', v_currency,
    'status', 'pending',
    'remaining_balance', v_available_balance - p_amount,
    'message', 'Payout request submitted. Our team will process it within 3-5 business days.'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION request_payout(DECIMAL) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- FIX C-3 / H17: Patched update_commission_debt
-- Adds FOR UPDATE row lock before the upsert to prevent
-- concurrent drift, and uses EXCLUDED for correct values.
-- ════════════════════════════════════════════════════════════

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

  -- H17 FIX: Lock existing row first to prevent concurrent drift.
  -- If the row doesn't exist yet, the INSERT below will create it.
  -- The lock serialises concurrent calls for the same (organizer, event).
  PERFORM 1 FROM commission_debt
  WHERE organizer_id = v_org_id AND event_id = p_event_id
  FOR UPDATE;

  -- Upsert debt record with correct balance calculation.
  -- Uses EXCLUDED to reference the VALUES being inserted, so the
  -- ON CONFLICT arithmetic is unambiguous.
  INSERT INTO commission_debt (
    organizer_id, event_id, commission_rate,
    total_manual_sales, commission_owed, commission_balance, status
  ) VALUES (
    v_org_id, p_event_id, v_rate,
    p_sale_amount, p_fee_amount, p_fee_amount, 'accruing'
  )
  ON CONFLICT (organizer_id, event_id) DO UPDATE SET
    total_manual_sales = commission_debt.total_manual_sales + EXCLUDED.total_manual_sales,
    commission_owed    = commission_debt.commission_owed    + EXCLUDED.commission_owed,
    commission_balance = (commission_debt.commission_owed   + EXCLUDED.commission_owed) - commission_debt.commission_paid,
    updated_at         = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- FIX M-8: Patched create_manual_transfer_order
-- Increases the random portion of transfer_reference from
-- 4 hex chars (65 K) to 12 hex chars (281 trillion).
-- Based on the latest version from migration-v53.
-- ════════════════════════════════════════════════════════════

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

  -- Verify this payment method is accepted/configured (support dynamic merging of organizer manual methods)
  IF NOT (p_payment_method = ANY(v_event.accepted_payment_methods)) AND v_dest IS NULL THEN
    RETURN jsonb_build_object('error', 'This payment method is not accepted or configured for this event');
  END IF;

  -- ═══ PRICING: Use the same calculation as Stripe checkout ═══
  v_breakdown := calculate_order_breakdown_v3(p_tier_id, p_quantity, p_promo_code);

  IF v_breakdown IS NULL OR v_breakdown ? 'error' THEN
    RETURN jsonb_build_object('error', COALESCE(v_breakdown->>'error', 'Pricing calculation failed'));
  END IF;

  -- ═══ RESERVE INVENTORY ═══
  -- Use the same reservation system as Stripe checkout
  -- NOTE: Reservation failures (sold out, lock contention) will now
  -- propagate as real exceptions, causing proper transaction rollback.
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
  -- M-8 FIX: Increased from 4 to 12 random hex chars
  -- (65 K possible values → 281 trillion possible values)
  v_reference := 'EVT-' ||
    upper(substring(p_event_id::TEXT from 1 for 4)) || '-' ||
    upper(substring(md5(random()::TEXT || clock_timestamp()::TEXT) from 1 for 12));

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
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- GRANTS (idempotent)
-- ════════════════════════════════════════════════════════════

-- request_payout: authenticated only
GRANT EXECUTE ON FUNCTION request_payout(DECIMAL) TO authenticated;

-- update_commission_debt: internal / service-role only (no public grant)

-- create_manual_transfer_order: authenticated + anon (guest checkout)
GRANT EXECUTE ON FUNCTION create_manual_transfer_order(
  UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], TEXT, TEXT, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION create_manual_transfer_order(
  UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], TEXT, TEXT, TEXT
) TO anon;

-- get_exchange_rate: authenticated (read-only helper)
GRANT EXECUTE ON FUNCTION get_exchange_rate(TEXT, TEXT) TO authenticated;

-- platform_exchange_rates: read for authenticated, write for admins via RLS
ALTER TABLE platform_exchange_rates ENABLE ROW LEVEL SECURITY;

-- Everyone can read rates (they're not sensitive)
DO $$ BEGIN
  CREATE POLICY "exchange_rates_select_all"
    ON platform_exchange_rates FOR SELECT
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only admins can modify rates
DO $$ BEGIN
  CREATE POLICY "exchange_rates_admin_write"
    ON platform_exchange_rates FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON platform_exchange_rates TO authenticated;
GRANT SELECT ON platform_exchange_rates TO anon;


-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v56 COMPLETE
--
-- Verification:
--
--   -- Check exchange rate table
--   SELECT * FROM platform_exchange_rates;
--
--   -- Test the helper
--   SELECT get_exchange_rate('USD', 'EGP');
--   SELECT get_exchange_rate('EGP', 'USD');
--
--   -- Verify functions were replaced
--   SELECT proname, prosrc
--   FROM pg_proc
--   WHERE proname IN ('request_payout', 'update_commission_debt', 'create_manual_transfer_order');
--
--   -- Confirm no hardcoded 50.0 remains in request_payout
--   SELECT prosrc FROM pg_proc WHERE proname = 'request_payout';
--   -- Should NOT contain '/ 50.0' or '* 50.0'
-- ════════════════════════════════════════════════════════════
