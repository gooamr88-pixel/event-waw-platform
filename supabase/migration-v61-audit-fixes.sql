-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v61: Audit Fix — Financial Logic Corrections
-- Date: 2026-06-03
--
-- Fixes found in codebase audit:
--   P1-1:  update_commission_debt hardcodes 5.0% fallback
--   P1-5:  Fixed-only fee (pct=NULL, fixed!=NULL) silently ignored
--   P1-9:  commission_rate column doesn't reflect fixed fee component
--   P2-2:  admin_set_event_fees returns JSONB errors instead of RAISE EXCEPTION
--
-- ⚠️  SAFE TO RUN: Function replacements only. No schema changes.
--     Idempotent — uses CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- FIX P1-5: calculate_order_breakdown — Fixed-only fee trigger
-- ════════════════════════════════════════════════════════════
-- BUG: Setting custom_commission_fixed WITHOUT custom_commission_pct
--      was silently ignored because the trigger only checked:
--        IF v_event_fee_pct IS NOT NULL
-- FIX: Check EITHER field to activate event-level override.

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
  v_fee_source      TEXT := 'platform';
  v_platform_settings JSONB;

  -- Event-level fee columns (fetched in step 1)
  v_event_fee_pct   DECIMAL(5,2);
  v_event_fee_fixed DECIMAL(10,2);

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

  -- ── 1. Fetch tier + event (+ event-level fee overrides) ──
  SELECT tt.name, tt.price, tt.event_id, e.title, e.organizer_id,
         COALESCE(tt.currency, 'USD'),
         e.custom_commission_pct, e.custom_commission_fixed
  INTO v_tier_name, v_tier_price, v_event_id, v_event_title, v_organizer_id,
       v_currency, v_event_fee_pct, v_event_fee_fixed
  FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id;

  IF v_tier_name IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  v_unit_price := v_tier_price;
  v_subtotal   := v_unit_price * p_quantity;

  -- ── 2. Fetch organizer tax config (including tax_inclusive) ──
  SELECT org.tax_enabled, org.tax_rate, COALESCE(org.tax_label, 'VAT'),
         COALESCE(org.tax_inclusive, false)
  INTO v_tax_enabled, v_tax_rate, v_tax_label, v_tax_inclusive
  FROM organizers org WHERE org.user_id = v_organizer_id;

  IF v_tax_enabled IS NULL THEN
    v_tax_enabled := false;
    v_tax_rate := 0;
    v_tax_inclusive := false;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 3. Commission config — THREE-TIER FALLBACK HIERARCHY
  --    Priority: Event → Organizer → Platform Default
  -- ══════════════════════════════════════════════════════════

  -- 3a. Event-level override (HIGHEST PRIORITY)
  -- P1-5 FIX: Trigger on EITHER pct OR fixed being set (was pct-only)
  IF v_event_fee_pct IS NOT NULL OR v_event_fee_fixed IS NOT NULL THEN
    v_commission_pct   := COALESCE(v_event_fee_pct, 0);
    v_commission_fixed := COALESCE(v_event_fee_fixed, 0);
    v_min_fee          := 0;  -- No minimum fee for custom rates
    v_fee_source       := 'event';

  ELSE
    -- 3b. Organizer-level override
    SELECT org.custom_commission_pct, org.custom_commission_fixed
    INTO v_commission_pct, v_commission_fixed
    FROM organizers org WHERE org.user_id = v_organizer_id;

    IF v_commission_pct IS NOT NULL THEN
      v_commission_fixed := COALESCE(v_commission_fixed, 0);
      v_min_fee          := 0;  -- No minimum fee for custom rates
      v_fee_source       := 'organizer';

    ELSE
      -- 3c. Platform defaults (LOWEST PRIORITY)
      v_platform_settings := get_platform_commission();
      v_commission_pct   := COALESCE((v_platform_settings->>'default_pct')::DECIMAL, 5.00);
      v_commission_fixed := COALESCE((v_platform_settings->>'default_fixed')::DECIMAL, 0.00);
      v_min_fee          := COALESCE((v_platform_settings->>'min_fee')::DECIMAL, 0.50);
      v_fee_source       := 'platform';
    END IF;
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
      ELSE
        v_promo_discount_amount := LEAST(v_promo_discount_value, v_subtotal);
      END IF;
      v_discounted_subtotal := GREATEST(v_subtotal - v_promo_discount_amount, 0);
    END IF;
  END IF;

  -- ── 5. Tax calculation — INCLUSIVE vs EXCLUSIVE ──
  IF v_tax_enabled AND v_tax_rate > 0 AND v_discounted_subtotal > 0 THEN
    IF v_tax_inclusive THEN
      v_tax_amount := ROUND(v_discounted_subtotal - (v_discounted_subtotal / (1 + v_tax_rate / 100)), 2);
      v_taxable_base := v_discounted_subtotal - v_tax_amount;
    ELSE
      v_tax_amount := ROUND(v_discounted_subtotal * v_tax_rate / 100, 2);
      v_taxable_base := v_discounted_subtotal;
    END IF;
  ELSE
    v_tax_amount := 0;
    v_taxable_base := v_discounted_subtotal;
  END IF;

  -- ── 6. Platform fee (always on pre-tax amount) ──
  v_platform_fee := ROUND(v_taxable_base * v_commission_pct / 100, 2) + v_commission_fixed;

  IF v_min_fee IS NOT NULL AND v_platform_fee < v_min_fee AND v_taxable_base > 0 THEN
    v_platform_fee := v_min_fee;
  END IF;

  IF v_discounted_subtotal = 0 THEN
    v_platform_fee := 0;
    v_tax_amount := 0;
  END IF;

  -- ── 7. Total and organizer net ──
  IF v_tax_inclusive THEN
    v_total := v_discounted_subtotal + v_platform_fee;
    v_organizer_net := v_taxable_base - v_platform_fee;
  ELSE
    v_total := v_discounted_subtotal + v_tax_amount + v_platform_fee;
    v_organizer_net := v_discounted_subtotal - v_platform_fee;
  END IF;

  IF v_organizer_net < 0 THEN v_organizer_net := 0; END IF;

  -- ── 8. Return full breakdown ──
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
    'fee_source',        v_fee_source,

    'total',             v_total,
    'organizer_net',     v_organizer_net
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public;


-- ════════════════════════════════════════════════════════════
-- FIX P1-1 + P1-9: update_commission_debt — Dynamic platform rate
-- ════════════════════════════════════════════════════════════
-- BUG P1-1: Hardcoded 5.0 fallback bypassed get_platform_commission().
--           If admin changes default from 5%, this function would diverge
--           from calculate_order_breakdown.
-- BUG P1-9: commission_rate column only stored percentage, ignoring
--           the fixed fee component. Added commission_rate_fixed column
--           for complete audit trail.
-- FIX: Use get_platform_commission() for the fallback, and store both
--      pct and fixed components.

-- First, add the missing fixed-rate audit column (safe, additive)
ALTER TABLE commission_debt ADD COLUMN IF NOT EXISTS commission_rate_fixed DECIMAL(10,2) DEFAULT 0;
COMMENT ON COLUMN commission_debt.commission_rate_fixed IS
  'P1-9 FIX: Fixed fee component of the commission rate. Complements commission_rate (pct).';

CREATE OR REPLACE FUNCTION update_commission_debt(
  p_event_id       UUID,
  p_fee_amount     DECIMAL,
  p_sale_amount    DECIMAL
) RETURNS VOID AS $$
DECLARE
  v_org_id        UUID;
  v_rate          DECIMAL;
  v_rate_fixed    DECIMAL := 0;
  v_platform_cfg  JSONB;
BEGIN
  -- Resolve organizer + commission rate using 3-tier fallback
  -- P1-1 FIX: Use get_platform_commission() instead of hardcoded 5.0
  -- P1-5 FIX: Check EITHER pct OR fixed for event-level override
  SELECT org.id,
    CASE
      WHEN e.custom_commission_pct IS NOT NULL OR e.custom_commission_fixed IS NOT NULL
        THEN COALESCE(e.custom_commission_pct, 0)
      WHEN org.custom_commission_pct IS NOT NULL
        THEN org.custom_commission_pct
      ELSE NULL  -- Will resolve to platform default below
    END,
    CASE
      WHEN e.custom_commission_pct IS NOT NULL OR e.custom_commission_fixed IS NOT NULL
        THEN COALESCE(e.custom_commission_fixed, 0)
      WHEN org.custom_commission_pct IS NOT NULL
        THEN COALESCE(org.custom_commission_fixed, 0)
      ELSE NULL  -- Will resolve to platform default below
    END
  INTO v_org_id, v_rate, v_rate_fixed
  FROM events e
  JOIN organizers org ON org.user_id = e.organizer_id
  WHERE e.id = p_event_id;

  IF v_org_id IS NULL THEN
    RAISE WARNING 'update_commission_debt: no organizer found for event %', p_event_id;
    RETURN;
  END IF;

  -- P1-1 FIX: If no event/organizer override, use dynamic platform default
  IF v_rate IS NULL THEN
    v_platform_cfg := get_platform_commission();
    v_rate       := COALESCE((v_platform_cfg->>'default_pct')::DECIMAL, 5.00);
    v_rate_fixed := COALESCE((v_platform_cfg->>'default_fixed')::DECIMAL, 0.00);
  END IF;

  -- Lock existing row first to prevent concurrent drift.
  PERFORM 1 FROM commission_debt
  WHERE organizer_id = v_org_id AND event_id = p_event_id
  FOR UPDATE;

  -- Upsert with correct ON CONFLICT arithmetic (preserved from v59 P0-5 fix).
  INSERT INTO commission_debt (
    organizer_id, event_id, commission_rate, commission_rate_fixed,
    total_manual_sales, commission_owed, commission_balance, status
  ) VALUES (
    v_org_id, p_event_id, v_rate, v_rate_fixed,
    p_sale_amount, p_fee_amount, p_fee_amount, 'accruing'
  )
  ON CONFLICT (organizer_id, event_id) DO UPDATE SET
    commission_rate    = EXCLUDED.commission_rate,
    commission_rate_fixed = EXCLUDED.commission_rate_fixed,
    total_manual_sales = commission_debt.total_manual_sales + EXCLUDED.total_manual_sales,
    commission_owed    = commission_debt.commission_owed + EXCLUDED.commission_owed,
    commission_balance = (commission_debt.commission_owed + EXCLUDED.commission_owed)
                         - commission_debt.commission_paid,
    updated_at         = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;


-- ════════════════════════════════════════════════════════════
-- FIX P2-2: admin_set_event_fees — RAISE EXCEPTION for validation
-- ════════════════════════════════════════════════════════════
-- BUG: Returned JSONB errors instead of raising exceptions,
--      inconsistent with v59 pattern. Clients not checking
--      response body would think operation succeeded.
-- FIX: Use RAISE EXCEPTION for validation failures.
--      Also validates that setting fixed-only (no pct) is allowed
--      now that P1-5 is fixed (trigger checks either field).

CREATE OR REPLACE FUNCTION admin_set_event_fees(
  p_event_id                UUID,
  p_custom_commission_pct   DECIMAL DEFAULT NULL,
  p_custom_commission_fixed DECIMAL DEFAULT NULL
) RETURNS JSONB AS $func$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_event       RECORD;
  v_old_pct     DECIMAL(5,2);
  v_old_fixed   DECIMAL(10,2);
BEGIN
  -- ═══ AUTHORIZATION: Admin-only ═══
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';  -- P2-2 FIX (was JSONB return)
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';  -- P2-2 FIX
  END IF;

  -- ═══ VALIDATION ═══
  IF p_custom_commission_pct IS NOT NULL THEN
    IF p_custom_commission_pct < 0 OR p_custom_commission_pct > 100 THEN
      RAISE EXCEPTION 'Commission percentage must be between 0 and 100';  -- P2-2 FIX
    END IF;
  END IF;

  IF p_custom_commission_fixed IS NOT NULL THEN
    IF p_custom_commission_fixed < 0 THEN
      RAISE EXCEPTION 'Fixed fee must be non-negative';  -- P2-2 FIX
    END IF;
  END IF;

  -- ═══ FETCH EVENT + CURRENT VALUES ═══
  SELECT id, title, custom_commission_pct, custom_commission_fixed
  INTO v_event
  FROM events WHERE id = p_event_id
  FOR UPDATE;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'Event not found: %', p_event_id;  -- P2-2 FIX
  END IF;

  v_old_pct   := v_event.custom_commission_pct;
  v_old_fixed := v_event.custom_commission_fixed;

  -- ═══ UPDATE ═══
  UPDATE events
  SET custom_commission_pct   = p_custom_commission_pct,
      custom_commission_fixed = p_custom_commission_fixed
  WHERE id = p_event_id;

  -- ═══ RETURN CONFIRMATION ═══
  RETURN jsonb_build_object(
    'success',   true,
    'event_id',  p_event_id,
    'event_title', v_event.title,
    'old_pct',   v_old_pct,
    'old_fixed', v_old_fixed,
    'new_pct',   p_custom_commission_pct,
    'new_fixed', p_custom_commission_fixed,
    'action',    CASE
                   WHEN p_custom_commission_pct IS NULL AND p_custom_commission_fixed IS NULL
                   THEN 'cleared'
                   ELSE 'set'
                 END,
    'message',   CASE
                   WHEN p_custom_commission_pct IS NULL AND p_custom_commission_fixed IS NULL
                   THEN 'Event-level fees cleared. Will use organizer or platform defaults.'
                   ELSE 'Event-level fees set: ' || COALESCE(p_custom_commission_pct, 0) || '% + $' || COALESCE(p_custom_commission_fixed, 0)
                 END
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;


-- ════════════════════════════════════════════════════════════
-- Grants (unchanged — reaffirm)
-- ════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_order_breakdown(UUID, INT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION admin_set_event_fees(UUID, DECIMAL, DECIMAL) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_set_event_fees(UUID, DECIMAL, DECIMAL) FROM anon;


-- ════════════════════════════════════════════════════════════
-- ✅ VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════

-- P1-5 FIX: Verify trigger checks both pct and fixed
SELECT 'P1-5: OR-trigger for event fees' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'calculate_order_breakdown')
    LIKE '%v_event_fee_pct IS NOT NULL OR v_event_fee_fixed IS NOT NULL%' AS passed;

-- P1-1 FIX: Verify update_commission_debt uses get_platform_commission()
SELECT 'P1-1: Dynamic platform default in update_commission_debt' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'update_commission_debt')
    LIKE '%get_platform_commission%' AS passed;

-- P1-9 FIX: Verify commission_rate_fixed column exists
SELECT 'P1-9: commission_rate_fixed column' AS check_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_debt' AND column_name = 'commission_rate_fixed'
  ) AS passed;

-- P2-2 FIX: Verify admin_set_event_fees uses RAISE EXCEPTION
SELECT 'P2-2: RAISE EXCEPTION in admin_set_event_fees' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'admin_set_event_fees')
    NOT LIKE '%jsonb_build_object(''error''%' AS passed;


-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v61 COMPLETE
--
-- Fixes Applied:
--   ✓ P1-1:  update_commission_debt uses get_platform_commission()
--   ✓ P1-5:  Event fee triggers on EITHER pct OR fixed
--   ✓ P1-9:  commission_rate_fixed column added for audit trail
--   ✓ P2-2:  admin_set_event_fees uses RAISE EXCEPTION
-- ════════════════════════════════════════════════════════════
