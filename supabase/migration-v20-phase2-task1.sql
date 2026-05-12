-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v20 Phase 2 Task 1
-- Financial Calculation RPCs: Tax + Platform Commission Engine
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates new functions + seeds default settings.
-- Does NOT drop or modify any existing data.
--
-- BRD Alignment:
--   • Section 6:  "الضريبة والعمولة يجب أن تُحسب في الخادم"
--   • Section 6:  "يجب حفظ snapshot من كل الرسوم وقت الشراء"
--   • Section 8:  "عمولة المنصة: نسبة + مبلغ ثابت"
--   • Section 18: Payments table financial breakdown
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: Seed Platform Commission Defaults ════════════
-- Uses the existing platform_settings key-value table.
-- Default: 5% + $0 fixed per order.

INSERT INTO platform_settings (key, value)
VALUES (
  'commission',
  jsonb_build_object(
    'default_pct',   5.00,     -- نسبة العمولة الافتراضية (5%)
    'default_fixed', 0.00,     -- مبلغ ثابت إضافي ($0)
    'min_fee',       0.50,     -- الحد الأدنى للعمولة ($0.50)
    'max_fee',       NULL,     -- لا يوجد حد أعلى
    'currency',      'USD'
  )
)
ON CONFLICT (key) DO NOTHING;  -- Don't overwrite if admin already configured


-- ════════════ STEP 2: get_platform_commission() ════════════
-- Returns the platform's default commission settings.
-- Used by calculate_order_breakdown to determine fees.

DROP FUNCTION IF EXISTS get_platform_commission();

CREATE OR REPLACE FUNCTION get_platform_commission()
RETURNS JSONB AS $func$
DECLARE
  v_settings JSONB;
BEGIN
  SELECT value INTO v_settings
  FROM platform_settings
  WHERE key = 'commission';

  -- Fallback if no settings exist
  IF v_settings IS NULL THEN
    v_settings := jsonb_build_object(
      'default_pct',   5.00,
      'default_fixed', 0.00,
      'min_fee',       0.50,
      'max_fee',       NULL
    );
  END IF;

  RETURN v_settings;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_platform_commission() TO authenticated;


-- ════════════ STEP 3: calculate_order_breakdown() ════════════
-- THE CORE FINANCIAL ENGINE.
--
-- Input:  tier_id, quantity, optional promo_code
-- Output: Full financial breakdown as JSONB
--
-- Logic:
--   1. Look up tier price + event
--   2. Look up organizer's tax config (from organizers table)
--   3. Look up commission (organizer custom > platform default)
--   4. Apply promo code discount if valid
--   5. Calculate: subtotal → discount → tax → platform_fee → total
--   6. Return everything as a snapshot-ready JSONB object
--
-- This function is called:
--   A. By the frontend (via RPC) to DISPLAY the breakdown before checkout
--   B. By create-checkout Edge Function to SAVE the breakdown with the order
--
-- SECURITY: DEFINER — runs as postgres, no RLS bypass needed.
-- The function reads public data (tiers, events) so any authenticated user can call it.

DROP FUNCTION IF EXISTS calculate_order_breakdown(UUID, INT, TEXT);

CREATE OR REPLACE FUNCTION calculate_order_breakdown(
  p_tier_id    UUID,
  p_quantity   INT DEFAULT 1,
  p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB AS $func$
DECLARE
  -- Tier + Event
  v_tier_name       TEXT;
  v_tier_price      DECIMAL(10,2);
  v_event_id        UUID;
  v_event_title     TEXT;
  v_organizer_id    UUID;
  v_currency        TEXT;

  -- Organizer tax config
  v_tax_enabled     BOOLEAN := false;
  v_tax_rate        DECIMAL(5,2) := 0;
  v_tax_label       TEXT := 'VAT';

  -- Commission config
  v_commission_pct  DECIMAL(5,2);
  v_commission_fixed DECIMAL(10,2);
  v_min_fee         DECIMAL(10,2);
  v_platform_settings JSONB;

  -- Promo
  v_promo_id        UUID;
  v_promo_discount_type TEXT;
  v_promo_discount_value DECIMAL(10,2) := 0;
  v_promo_discount_amount DECIMAL(10,2) := 0;

  -- Calculated amounts
  v_unit_price      DECIMAL(10,2);
  v_subtotal        DECIMAL(10,2);
  v_discounted_subtotal DECIMAL(10,2);
  v_tax_amount      DECIMAL(10,2) := 0;
  v_platform_fee    DECIMAL(10,2) := 0;
  v_total           DECIMAL(10,2);
  v_organizer_net   DECIMAL(10,2);

BEGIN
  -- ── Validate input ──
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  -- ── 1. Fetch tier + event info ──
  SELECT tt.name, tt.price, tt.event_id, e.title, e.organizer_id,
         COALESCE(tt.currency, 'USD')
  INTO v_tier_name, v_tier_price, v_event_id, v_event_title, v_organizer_id,
       v_currency
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id;

  IF v_tier_name IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  v_unit_price := v_tier_price;
  v_subtotal   := v_unit_price * p_quantity;

  -- ── 2. Fetch organizer tax config ──
  SELECT org.tax_enabled, org.tax_rate, COALESCE(org.tax_label, 'VAT')
  INTO v_tax_enabled, v_tax_rate, v_tax_label
  FROM organizers org
  WHERE org.user_id = v_organizer_id;

  -- If organizer hasn't set up their organizers row yet, tax = 0
  IF v_tax_enabled IS NULL THEN
    v_tax_enabled := false;
    v_tax_rate := 0;
  END IF;

  -- ── 3. Fetch commission config (organizer custom > platform default) ──
  SELECT org.custom_commission_pct, org.custom_commission_fixed
  INTO v_commission_pct, v_commission_fixed
  FROM organizers org
  WHERE org.user_id = v_organizer_id;

  -- If organizer has no custom commission, use platform defaults
  IF v_commission_pct IS NULL THEN
    v_platform_settings := get_platform_commission();
    v_commission_pct   := COALESCE((v_platform_settings->>'default_pct')::DECIMAL, 5.00);
    v_commission_fixed := COALESCE((v_platform_settings->>'default_fixed')::DECIMAL, 0.00);
    v_min_fee          := COALESCE((v_platform_settings->>'min_fee')::DECIMAL, 0.50);
  ELSE
    v_commission_fixed := COALESCE(v_commission_fixed, 0);
    v_min_fee := 0;
  END IF;

  -- ── 4. Apply promo code discount ──
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
      ELSE -- 'fixed'
        v_promo_discount_amount := LEAST(v_promo_discount_value, v_subtotal);
      END IF;
      v_discounted_subtotal := GREATEST(v_subtotal - v_promo_discount_amount, 0);
    END IF;
  END IF;

  -- ── 5. Calculate tax ──
  IF v_tax_enabled AND v_tax_rate > 0 THEN
    v_tax_amount := ROUND(v_discounted_subtotal * v_tax_rate / 100, 2);
  END IF;

  -- ── 6. Calculate platform fee ──
  -- Fee = percentage of discounted subtotal + fixed amount
  v_platform_fee := ROUND(v_discounted_subtotal * v_commission_pct / 100, 2) + v_commission_fixed;

  -- Enforce minimum fee
  IF v_min_fee IS NOT NULL AND v_platform_fee < v_min_fee AND v_discounted_subtotal > 0 THEN
    v_platform_fee := v_min_fee;
  END IF;

  -- Free tickets = no fees
  IF v_discounted_subtotal = 0 THEN
    v_platform_fee := 0;
    v_tax_amount := 0;
  END IF;

  -- ── 7. Calculate total and organizer net ──
  v_total := v_discounted_subtotal + v_tax_amount + v_platform_fee;
  v_organizer_net := v_discounted_subtotal - v_platform_fee;
  IF v_organizer_net < 0 THEN v_organizer_net := 0; END IF;

  -- ── 8. Return full breakdown ──
  RETURN jsonb_build_object(
    -- Tier info
    'tier_id',           p_tier_id,
    'tier_name',         v_tier_name,
    'unit_price',        v_unit_price,
    'quantity',          p_quantity,
    'currency',          v_currency,
    'event_id',          v_event_id,
    'event_title',       v_event_title,
    'organizer_id',      v_organizer_id,

    -- Price breakdown
    'subtotal',          v_subtotal,
    'promo_code',        COALESCE(p_promo_code, ''),
    'promo_id',          v_promo_id,
    'promo_discount',    v_promo_discount_amount,
    'discounted_subtotal', v_discounted_subtotal,

    -- Tax
    'tax_enabled',       v_tax_enabled,
    'tax_rate',          v_tax_rate,
    'tax_label',         v_tax_label,
    'tax_amount',        v_tax_amount,

    -- Platform fee
    'platform_fee_pct',  v_commission_pct,
    'platform_fee_fixed', v_commission_fixed,
    'platform_fee_total', v_platform_fee,

    -- Totals
    'total',             v_total,
    'organizer_net',     v_organizer_net
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) TO authenticated;
-- Also allow anon for guest checkout preview:
GRANT EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) TO anon;


-- ════════════ ✅ MIGRATION v20 TASK 1 COMPLETE ════════════
--
-- Functions created:
--   ✓ get_platform_commission()  — returns JSONB commission settings
--   ✓ calculate_order_breakdown(tier_id, qty, promo_code) — full breakdown
--
-- Platform settings seeded:
--   ✓ commission: { default_pct: 5%, default_fixed: $0, min_fee: $0.50 }
--
-- Verification:
--
--   -- Check commission settings:
--   SELECT * FROM platform_settings WHERE key = 'commission';
--
--   -- Test breakdown (replace with a real tier_id):
--   SELECT calculate_order_breakdown('<tier_id>', 2, NULL);
--
--   -- Test with promo code:
--   SELECT calculate_order_breakdown('<tier_id>', 2, 'SAVE10');
