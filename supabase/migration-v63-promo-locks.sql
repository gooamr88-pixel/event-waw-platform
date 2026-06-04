-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v63: Promo Code Discount Scoping
-- Date: 2026-06-04
--
-- Purpose:
--   Add `allowed_categories` and `allowed_rows` to the `promo_codes` table.
--   Update `calculate_seated_breakdown` to restrict discount application
--   only to seats matching the specified categories or rows.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. SCHEMA CHANGES: Add Columns to `promo_codes` ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promo_codes'
      AND column_name = 'allowed_categories'
  ) THEN
    ALTER TABLE public.promo_codes
      ADD COLUMN allowed_categories TEXT[] DEFAULT NULL;
    COMMENT ON COLUMN promo_codes.allowed_categories IS
      'v63: Specific seat categories eligible for this discount (null = all).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promo_codes'
      AND column_name = 'allowed_rows'
  ) THEN
    ALTER TABLE public.promo_codes
      ADD COLUMN allowed_rows TEXT[] DEFAULT NULL;
    COMMENT ON COLUMN promo_codes.allowed_rows IS
      'v63: Specific row labels eligible for this discount (null = all).';
  END IF;
END $$;


-- ── 2. RPC: calculate_seated_breakdown() (UPDATED) ──
CREATE OR REPLACE FUNCTION calculate_seated_breakdown(
  p_seat_ids   UUID[],
  p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB AS $func$
DECLARE
  v_seat_count      INT;
  v_event_id        UUID;
  v_event_title     TEXT;
  v_organizer_id    UUID;
  v_currency        TEXT;

  -- Per-seat prices
  v_seat_prices     JSONB;
  v_subtotal        DECIMAL(10,2) := 0;

  -- Tax config
  v_tax_enabled     BOOLEAN := false;
  v_tax_rate        DECIMAL(5,2) := 0;
  v_tax_label       TEXT := 'VAT';
  v_tax_inclusive    BOOLEAN := false;
  v_tax_amount      DECIMAL(10,2) := 0;
  v_taxable_base    DECIMAL(10,2) := 0;

  -- Commission config
  v_commission_pct  DECIMAL(5,2);
  v_commission_fixed DECIMAL(10,2);
  v_min_fee         DECIMAL(10,2);
  v_fee_source      TEXT := 'platform';
  v_platform_settings JSONB;
  v_event_fee_pct   DECIMAL(5,2);
  v_event_fee_fixed DECIMAL(10,2);

  -- Promo
  v_promo_id        UUID;
  v_promo_discount_type TEXT;
  v_promo_discount_value DECIMAL(10,2) := 0;
  v_promo_discount_amount DECIMAL(10,2) := 0;
  
  -- v63: Discount scoping variables
  v_allowed_categories TEXT[] := NULL;
  v_allowed_rows      TEXT[] := NULL;
  v_qualifying_sum    DECIMAL(10,2) := 0;

  -- Totals
  v_discounted_subtotal DECIMAL(10,2);
  v_platform_fee    DECIMAL(10,2) := 0;
  v_total           DECIMAL(10,2);
  v_organizer_net   DECIMAL(10,2);

BEGIN
  -- ── Validate input ──
  v_seat_count := COALESCE(array_length(p_seat_ids, 1), 0);
  IF v_seat_count < 1 THEN
    RAISE EXCEPTION 'At least 1 seat must be provided';
  END IF;
  IF v_seat_count > 10 THEN
    RAISE EXCEPTION 'Cannot calculate breakdown for more than 10 seats at once';
  END IF;

  -- ── 1. Resolve event from first seat ──
  SELECT vm.event_id, e.title, e.organizer_id,
         COALESCE(e.custom_commission_pct, NULL),
         COALESCE(e.custom_commission_fixed, NULL)
  INTO v_event_id, v_event_title, v_organizer_id,
       v_event_fee_pct, v_event_fee_fixed
  FROM seats s
  JOIN venue_maps vm ON vm.id = s.venue_map_id
  JOIN events e ON e.id = vm.event_id
  WHERE s.id = p_seat_ids[1];

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Seat not found or not linked to an event';
  END IF;

  -- Resolve currency from first tier found
  SELECT COALESCE(tt.currency, 'USD')
  INTO v_currency
  FROM seats s
  LEFT JOIN ticket_tiers tt ON tt.id = COALESCE(s.row_tier_id, s.ticket_tier_id)
  WHERE s.id = p_seat_ids[1];
  v_currency := COALESCE(v_currency, 'USD');

  -- ── 2. Compute per-seat effective prices ──
  SELECT
    jsonb_agg(jsonb_build_object(
      'seat_id',           s.id,
      'section_key',       s.section_key,
      'row_label',         COALESCE(s.custom_row_name, s.row_label),
      'seat_number',       s.seat_number,
      'seat_category',     COALESCE(s.seat_category, 'standard'),
      'effective_price',   COALESCE(s.price_override, rt.price, st.price, 0),
      'effective_tier_id', COALESCE(s.row_tier_id, s.ticket_tier_id),
      'effective_tier_name', COALESCE(rt.name, st.name, 'Unassigned'),
      'price_source',      CASE
                              WHEN s.price_override IS NOT NULL THEN 'seat_override'
                              WHEN s.row_tier_id IS NOT NULL    THEN 'row_tier'
                              WHEN s.ticket_tier_id IS NOT NULL THEN 'section_tier'
                              ELSE 'default'
                            END
    ) ORDER BY s.section_key, s.row_label, s.seat_number),
    COALESCE(SUM(COALESCE(s.price_override, rt.price, st.price, 0)), 0)
  INTO v_seat_prices, v_subtotal
  FROM seats s
  LEFT JOIN ticket_tiers st ON st.id = s.ticket_tier_id
  LEFT JOIN ticket_tiers rt ON rt.id = s.row_tier_id
  WHERE s.id = ANY(p_seat_ids);

  IF v_seat_prices IS NULL THEN
    RAISE EXCEPTION 'No seats found for the given IDs';
  END IF;

  -- ── 3. Fetch organizer tax config ──
  SELECT org.tax_enabled, org.tax_rate, COALESCE(org.tax_label, 'VAT'),
         COALESCE(org.tax_inclusive, false)
  INTO v_tax_enabled, v_tax_rate, v_tax_label, v_tax_inclusive
  FROM organizers org WHERE org.user_id = v_organizer_id;

  IF v_tax_enabled IS NULL THEN
    v_tax_enabled := false;
    v_tax_rate := 0;
    v_tax_inclusive := false;
  END IF;

  -- ── 4. Commission config — THREE-TIER FALLBACK ──
  --    Event → Organizer → Platform Default
  IF v_event_fee_pct IS NOT NULL OR v_event_fee_fixed IS NOT NULL THEN
    v_commission_pct   := COALESCE(v_event_fee_pct, 0);
    v_commission_fixed := COALESCE(v_event_fee_fixed, 0);
    v_min_fee          := 0;
    v_fee_source       := 'event';
  ELSE
    SELECT org.custom_commission_pct, org.custom_commission_fixed
    INTO v_commission_pct, v_commission_fixed
    FROM organizers org WHERE org.user_id = v_organizer_id;

    IF v_commission_pct IS NOT NULL THEN
      v_commission_fixed := COALESCE(v_commission_fixed, 0);
      v_min_fee          := 0;
      v_fee_source       := 'organizer';
    ELSE
      v_platform_settings := get_platform_commission();
      v_commission_pct   := COALESCE((v_platform_settings->>'default_pct')::DECIMAL, 5.00);
      v_commission_fixed := COALESCE((v_platform_settings->>'default_fixed')::DECIMAL, 0.00);
      v_min_fee          := COALESCE((v_platform_settings->>'min_fee')::DECIMAL, 0.50);
      v_fee_source       := 'platform';
    END IF;
  END IF;

  -- ── 5. Apply promo code discount (with v63 category & row discount scoping) ──
  v_discounted_subtotal := v_subtotal;

  IF p_promo_code IS NOT NULL AND trim(p_promo_code) != '' THEN
    SELECT pc.id, pc.discount_type, pc.discount_value, pc.allowed_categories, pc.allowed_rows
    INTO v_promo_id, v_promo_discount_type, v_promo_discount_value, v_allowed_categories, v_allowed_rows
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
      -- v63 scoping: determine the portion of subtotal that qualifies for the discount
      IF v_allowed_categories IS NULL AND v_allowed_rows IS NULL THEN
        v_qualifying_sum := v_subtotal;
      ELSE
        SELECT COALESCE(SUM(COALESCE(s.price_override, rt.price, st.price, 0)), 0)
        INTO v_qualifying_sum
        FROM seats s
        LEFT JOIN ticket_tiers st ON st.id = s.ticket_tier_id
        LEFT JOIN ticket_tiers rt ON rt.id = s.row_tier_id
        WHERE s.id = ANY(p_seat_ids)
          AND (v_allowed_categories IS NULL OR COALESCE(s.seat_category, 'standard') = ANY(v_allowed_categories))
          AND (v_allowed_rows IS NULL OR s.row_label = ANY(v_allowed_rows));
      END IF;

      IF v_promo_discount_type = 'percentage' THEN
        v_promo_discount_amount := ROUND(v_qualifying_sum * v_promo_discount_value / 100, 2);
      ELSE -- 'fixed'
        v_promo_discount_amount := LEAST(v_promo_discount_value, v_qualifying_sum);
      END IF;
      v_discounted_subtotal := GREATEST(v_subtotal - v_promo_discount_amount, 0);
    END IF;
  END IF;

  -- ── 6. Tax calculation — INCLUSIVE vs EXCLUSIVE ──
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

  -- ── 7. Platform fee (on pre-tax amount) ──
  v_platform_fee := ROUND(v_taxable_base * v_commission_pct / 100, 2) + v_commission_fixed;

  IF v_min_fee IS NOT NULL AND v_platform_fee < v_min_fee AND v_taxable_base > 0 THEN
    v_platform_fee := v_min_fee;
  END IF;

  IF v_discounted_subtotal = 0 THEN
    v_platform_fee := 0;
    v_tax_amount := 0;
  END IF;

  -- ── 8. Total and organizer net ──
  IF v_tax_inclusive THEN
    v_total := v_discounted_subtotal + v_platform_fee;
    v_organizer_net := v_taxable_base - v_platform_fee;
  ELSE
    v_total := v_discounted_subtotal + v_tax_amount + v_platform_fee;
    v_organizer_net := v_discounted_subtotal - v_platform_fee;
  END IF;

  IF v_organizer_net < 0 THEN v_organizer_net := 0; END IF;

  -- ── 9. Return full breakdown ──
  RETURN jsonb_build_object(
    -- Event context
    'event_id',            v_event_id,
    'event_title',         v_event_title,
    'organizer_id',        v_organizer_id,
    'currency',            v_currency,
    'seat_count',          v_seat_count,

    -- Per-seat breakdown (JSONB array)
    'seat_prices',         v_seat_prices,

    -- Price breakdown
    'subtotal',            v_subtotal,
    'promo_code',          COALESCE(p_promo_code, ''),
    'promo_id',            v_promo_id,
    'promo_discount',      v_promo_discount_amount,
    'discounted_subtotal', v_discounted_subtotal,

    -- Tax
    'tax_enabled',         v_tax_enabled,
    'tax_rate',            v_tax_rate,
    'tax_label',           v_tax_label,
    'tax_inclusive',        v_tax_inclusive,
    'tax_amount',          v_tax_amount,

    -- Platform fee
    'platform_fee_pct',    v_commission_pct,
    'platform_fee_fixed',  v_commission_fixed,
    'platform_fee_total',  v_platform_fee,
    'fee_source',          v_fee_source,

    -- Totals
    'total',               v_total,
    'organizer_net',       v_organizer_net
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public;
