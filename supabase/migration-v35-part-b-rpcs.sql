-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v35 Part B: RPCs
-- Terms Gates, Tax-Inclusive Breakdown, Payout Hardening
--
-- ⚠️ SAFE TO RUN: Replaces functions only. No data loss.
-- Run AFTER Part A (tables).
-- ═══════════════════════════════════════════════════════════════


-- ════════════ RPC 1: check_terms_compliance ════════════
-- Gate function: returns { compliant: bool, reason?, required_version? }
-- Called at publish time AND checkout time.
-- BRD Rule 3: Only blocks NEW publishing, not running events.

CREATE OR REPLACE FUNCTION check_terms_compliance(p_user_id UUID)
RETURNS JSONB AS $func$
DECLARE
  v_current_version TEXT;
  v_has_acceptance BOOLEAN;
BEGIN
  SELECT version_code INTO v_current_version
  FROM platform_terms_versions
  WHERE is_current = true AND terms_type = 'platform'
  LIMIT 1;

  -- No terms configured = no gate
  IF v_current_version IS NULL THEN
    RETURN jsonb_build_object('compliant', true, 'reason', 'No terms configured');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM terms_acceptances
    WHERE user_id = p_user_id
      AND terms_version = v_current_version
      AND terms_type = 'platform'
  ) INTO v_has_acceptance;

  IF NOT v_has_acceptance THEN
    RETURN jsonb_build_object(
      'compliant', false,
      'reason', 'You must accept the current platform terms (version ' || v_current_version || ') before publishing.',
      'required_version', v_current_version
    );
  END IF;

  RETURN jsonb_build_object('compliant', true, 'accepted_version', v_current_version);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION check_terms_compliance(UUID) TO authenticated;


-- ════════════ RPC 2: accept_platform_terms ════════════
-- Records acceptance in the immutable audit log + updates organizer cache.

CREATE OR REPLACE FUNCTION accept_platform_terms(
  p_version TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_version_rec RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Verify version exists
  SELECT version_code, content_hash INTO v_version_rec
  FROM platform_terms_versions
  WHERE version_code = p_version;

  IF v_version_rec IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid terms version: ' || p_version);
  END IF;

  -- Check if already accepted (idempotent)
  IF EXISTS(
    SELECT 1 FROM terms_acceptances
    WHERE user_id = v_user_id AND terms_version = p_version AND terms_type = 'platform'
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_accepted', true);
  END IF;

  SELECT id INTO v_org_id FROM organizers WHERE user_id = v_user_id;

  -- Append to immutable audit log
  INSERT INTO terms_acceptances (
    user_id, organizer_id, terms_type, terms_version,
    terms_hash, ip_address, user_agent
  ) VALUES (
    v_user_id, v_org_id, 'platform', p_version,
    v_version_rec.content_hash, p_ip_address, p_user_agent
  );

  -- Update denormalized cache on organizers
  IF v_org_id IS NOT NULL THEN
    UPDATE organizers SET
      terms_accepted_at = now(),
      terms_version = p_version,
      terms_current_version = p_version
    WHERE id = v_org_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'accepted_version', p_version,
    'accepted_at', now()
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION accept_platform_terms(TEXT, TEXT, TEXT) TO authenticated;


-- ════════════ RPC 3: calculate_order_breakdown (v2) ════════════
-- REPLACES the existing function.
-- NEW: tax_inclusive mode support per business rule #1.
--
-- Tax-EXCLUSIVE (default): total = subtotal + tax + fee
-- Tax-INCLUSIVE:           total = subtotal + fee
--   (tax is extracted FROM subtotal, organizer receives subtotal - tax - fee)

DROP FUNCTION IF EXISTS calculate_order_breakdown(UUID, INT, TEXT);

CREATE OR REPLACE FUNCTION calculate_order_breakdown(
  p_tier_id    UUID,
  p_quantity   INT DEFAULT 1,
  p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB AS $func$
DECLARE
  v_tier_name       TEXT;
  v_tier_price      DECIMAL(10,2);
  v_event_id        UUID;
  v_event_title     TEXT;
  v_organizer_id    UUID;
  v_currency        TEXT;

  v_tax_enabled     BOOLEAN := false;
  v_tax_rate        DECIMAL(5,2) := 0;
  v_tax_label       TEXT := 'VAT';
  v_tax_inclusive    BOOLEAN := false;

  v_commission_pct  DECIMAL(5,2);
  v_commission_fixed DECIMAL(10,2);
  v_min_fee         DECIMAL(10,2);
  v_platform_settings JSONB;

  v_promo_id        UUID;
  v_promo_discount_type TEXT;
  v_promo_discount_value DECIMAL(10,2) := 0;
  v_promo_discount_amount DECIMAL(10,2) := 0;

  v_unit_price      DECIMAL(10,2);
  v_subtotal        DECIMAL(10,2);
  v_discounted_subtotal DECIMAL(10,2);
  v_tax_amount      DECIMAL(10,2) := 0;
  v_platform_fee    DECIMAL(10,2) := 0;
  v_total           DECIMAL(10,2);
  v_organizer_net   DECIMAL(10,2);
  v_taxable_base    DECIMAL(10,2);
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  -- 1. Fetch tier + event
  SELECT tt.name, tt.price, tt.event_id, e.title, e.organizer_id,
         COALESCE(tt.currency, 'USD')
  INTO v_tier_name, v_tier_price, v_event_id, v_event_title, v_organizer_id, v_currency
  FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id;

  IF v_tier_name IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  v_unit_price := v_tier_price;
  v_subtotal   := v_unit_price * p_quantity;

  -- 2. Fetch organizer tax config (including tax_inclusive)
  SELECT org.tax_enabled, org.tax_rate, COALESCE(org.tax_label, 'VAT'),
         COALESCE(org.tax_inclusive, false)
  INTO v_tax_enabled, v_tax_rate, v_tax_label, v_tax_inclusive
  FROM organizers org WHERE org.user_id = v_organizer_id;

  IF v_tax_enabled IS NULL THEN
    v_tax_enabled := false;
    v_tax_rate := 0;
    v_tax_inclusive := false;
  END IF;

  -- 3. Commission config
  SELECT org.custom_commission_pct, org.custom_commission_fixed
  INTO v_commission_pct, v_commission_fixed
  FROM organizers org WHERE org.user_id = v_organizer_id;

  IF v_commission_pct IS NULL THEN
    v_platform_settings := get_platform_commission();
    v_commission_pct   := COALESCE((v_platform_settings->>'default_pct')::DECIMAL, 5.00);
    v_commission_fixed := COALESCE((v_platform_settings->>'default_fixed')::DECIMAL, 0.00);
    v_min_fee          := COALESCE((v_platform_settings->>'min_fee')::DECIMAL, 0.50);
  ELSE
    v_commission_fixed := COALESCE(v_commission_fixed, 0);
    v_min_fee := 0;
  END IF;

  -- 4. Promo code
  v_discounted_subtotal := v_subtotal;

  IF p_promo_code IS NOT NULL AND trim(p_promo_code) != '' THEN
    SELECT pc.id, pc.discount_type, pc.discount_value
    INTO v_promo_id, v_promo_discount_type, v_promo_discount_value
    FROM promo_codes pc
    WHERE pc.code = upper(trim(p_promo_code))
      AND pc.is_active = true
      AND (pc.event_id = v_event_id OR pc.event_id IS NULL)
      AND (pc.valid_from IS NULL OR pc.valid_from <= now())
      AND (pc.valid_until IS NULL OR pc.valid_until >= now())
      AND pc.used_count < pc.max_uses
      AND v_subtotal >= COALESCE(pc.min_order_amount, 0)
    LIMIT 1;

    IF v_promo_id IS NOT NULL THEN
      IF v_promo_discount_type = 'percentage' THEN
        v_promo_discount_amount := ROUND(v_subtotal * v_promo_discount_value / 100, 2);
      ELSE
        v_promo_discount_amount := LEAST(v_promo_discount_value, v_subtotal);
      END IF;
      v_discounted_subtotal := GREATEST(v_subtotal - v_promo_discount_amount, 0);
    END IF;
  END IF;

  -- 5. Tax calculation — INCLUSIVE vs EXCLUSIVE
  IF v_tax_enabled AND v_tax_rate > 0 AND v_discounted_subtotal > 0 THEN
    IF v_tax_inclusive THEN
      -- Tax is INCLUDED in the ticket price.
      -- Extract tax from the discounted subtotal.
      -- e.g. price=115, rate=15% → tax = 115 - (115 / 1.15) = 15
      v_tax_amount := ROUND(v_discounted_subtotal - (v_discounted_subtotal / (1 + v_tax_rate / 100)), 2);
      -- The taxable base (pre-tax price) for fee calculation
      v_taxable_base := v_discounted_subtotal - v_tax_amount;
    ELSE
      -- Tax is ADDED ON TOP of the ticket price (default).
      v_tax_amount := ROUND(v_discounted_subtotal * v_tax_rate / 100, 2);
      v_taxable_base := v_discounted_subtotal;
    END IF;
  ELSE
    v_tax_amount := 0;
    v_taxable_base := v_discounted_subtotal;
  END IF;

  -- 6. Platform fee (always on pre-tax amount)
  v_platform_fee := ROUND(v_taxable_base * v_commission_pct / 100, 2) + v_commission_fixed;

  IF v_min_fee IS NOT NULL AND v_platform_fee < v_min_fee AND v_taxable_base > 0 THEN
    v_platform_fee := v_min_fee;
  END IF;

  IF v_discounted_subtotal = 0 THEN
    v_platform_fee := 0;
    v_tax_amount := 0;
  END IF;

  -- 7. Total and organizer net
  IF v_tax_inclusive THEN
    -- Buyer pays: discounted_subtotal + platform_fee
    -- (tax already inside discounted_subtotal)
    v_total := v_discounted_subtotal + v_platform_fee;
    -- Organizer gets: taxable_base - platform_fee
    -- (organizer remits tax to government themselves)
    v_organizer_net := v_taxable_base - v_platform_fee;
  ELSE
    -- Buyer pays: discounted_subtotal + tax + platform_fee
    v_total := v_discounted_subtotal + v_tax_amount + v_platform_fee;
    -- Organizer gets: discounted_subtotal - platform_fee
    v_organizer_net := v_discounted_subtotal - v_platform_fee;
  END IF;

  IF v_organizer_net < 0 THEN v_organizer_net := 0; END IF;

  -- 8. Return
  RETURN jsonb_build_object(
    'tier_id',           p_tier_id,
    'tier_name',         v_tier_name,
    'unit_price',        v_unit_price,
    'quantity',          p_quantity,
    'currency',          v_currency,
    'event_id',          v_event_id,
    'event_title',       v_event_title,
    'organizer_id',      v_organizer_id,
    'subtotal',          v_subtotal,
    'promo_code',        COALESCE(p_promo_code, ''),
    'promo_id',          v_promo_id,
    'promo_discount',    v_promo_discount_amount,
    'discounted_subtotal', v_discounted_subtotal,
    'tax_enabled',       v_tax_enabled,
    'tax_rate',          v_tax_rate,
    'tax_label',         v_tax_label,
    'tax_inclusive',      v_tax_inclusive,
    'tax_amount',        v_tax_amount,
    'platform_fee_pct',  v_commission_pct,
    'platform_fee_fixed', v_commission_fixed,
    'platform_fee_total', v_platform_fee,
    'total',             v_total,
    'organizer_net',     v_organizer_net
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) TO anon;


-- ════════════ RPC 4: request_payout (v2) ════════════
-- REPLACES existing. Adds payout method validation.
-- BRD Rule 4: No minimum withdrawal limit.

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
  -- Check if organizer has manual transfer commission debt in EGP
  -- Propose EGP-EGP directly, convert USD payout to EGP debt using a standard 50.0 rate.
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

    -- Adjust EGP debt to payout currency
    IF v_currency = 'USD' AND COALESCE(v_debt.event_currency, 'EGP') = 'EGP' THEN
      v_deduct_amount := LEAST(v_remaining_payout_amount, ROUND(v_debt.commission_balance / 50.0, 2));
      
      IF v_deduct_amount > 0 THEN
        v_remaining_payout_amount := v_remaining_payout_amount - v_deduct_amount;
        v_total_deducted := v_total_deducted + v_deduct_amount;
        
        -- Record settlement in EGP (usd * 50)
        INSERT INTO commission_settlements (
          debt_id, organizer_id, amount, method,
          reference, verified_at, notes
        ) VALUES (
          v_debt.id, v_org.id, ROUND(v_deduct_amount * 50.0, 2), 'stripe_deduction',
          'auto_payout_deduction_' || v_payout_id::text, now(),
          'Auto-deducted from Stripe payout ' || v_payout_id::text || ' ($' || v_deduct_amount || ' converted to EGP)'
        );

        -- Update debt record
        UPDATE commission_debt
        SET commission_paid    = commission_paid + ROUND(v_deduct_amount * 50.0, 2),
            commission_balance = commission_balance - ROUND(v_deduct_amount * 50.0, 2),
            last_settled_at    = now(),
            settlement_method  = 'stripe_deduction',
            settlement_reference = 'auto_payout_deduction_' || v_payout_id::text,
            scanner_locked     = CASE WHEN commission_balance - ROUND(v_deduct_amount * 50.0, 2) <= 0 THEN false ELSE scanner_locked END,
            status             = CASE WHEN commission_balance - ROUND(v_deduct_amount * 50.0, 2) <= 0 THEN 'settled' ELSE status END,
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


-- ════════════ GRANTS (idempotent) ════════════

GRANT EXECUTE ON FUNCTION check_terms_compliance(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION check_terms_compliance(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION accept_platform_terms(TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION accept_platform_terms(TEXT, TEXT, TEXT) FROM anon;


-- ════════════ ✅ MIGRATION v35 COMPLETE ════════════
--
-- Verification:
--
--   SELECT * FROM platform_terms_versions;
--   SELECT check_terms_compliance('<user_id>');
--   SELECT accept_platform_terms('2026-05-15-v1');
--   SELECT calculate_order_breakdown('<tier_id>', 2, NULL);
--   SELECT request_payout(10.00);
