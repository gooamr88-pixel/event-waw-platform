-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v62: Per-Seat Properties & Price Overrides
-- Date: 2026-06-04
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️  SAFE TO RUN MULTIPLE TIMES: Fully idempotent.
--     - Column additions guarded by IF NOT EXISTS checks
--     - Functions use CREATE OR REPLACE
--     - Indexes use IF NOT EXISTS
--     - Constraints checked before creation
--
-- Purpose:
--   Enable per-seat and per-row control in the venue designer.
--   Previously, all seats in a section inherited the section's
--   tier (and its price). This migration adds:
--
--   1. price_override    — Per-seat price, bypasses tier pricing
--   2. seat_category     — standard, vip, premium, accessible, etc.
--   3. row_tier_id       — Row-level tier override (all seats in a
--                          row get this tier instead of the section's)
--   4. promo_code_lock   — Seat hidden until a specific promo code
--   5. notes             — Admin notes (e.g., 'Near exit')
--   6. custom_row_name   — Display name override for the row
--
-- RPCs updated:
--   ✓ get_seat_map()           — Returns new cols + effective pricing
--   ✓ reserve_seats()          — Removes same-tier constraint
--   ✓ reserve_guest_seats()    — Delegates to updated reserve_seats()
--   ✓ calculate_seated_breakdown() — NEW: per-seat price breakdown
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- SECTION 1: SCHEMA CHANGES — New Columns on `seats`
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 1. price_override: If set, overrides the tier's price for this seat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats'
      AND column_name = 'price_override'
  ) THEN
    ALTER TABLE public.seats
      ADD COLUMN price_override DECIMAL(10,2) DEFAULT NULL;
    COMMENT ON COLUMN seats.price_override IS
      'v62: Per-seat price override. If set, takes priority over tier price.';
  END IF;

  -- 2. seat_category: Classification for the seat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats'
      AND column_name = 'seat_category'
  ) THEN
    ALTER TABLE public.seats
      ADD COLUMN seat_category TEXT DEFAULT 'standard';
    COMMENT ON COLUMN seats.seat_category IS
      'v62: Seat classification (standard, vip, premium, accessible, restricted_view, companion).';
  END IF;

  -- 3. row_tier_id: Row-level tier override
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats'
      AND column_name = 'row_tier_id'
  ) THEN
    ALTER TABLE public.seats
      ADD COLUMN row_tier_id UUID DEFAULT NULL
        REFERENCES ticket_tiers(id) ON DELETE SET NULL;
    COMMENT ON COLUMN seats.row_tier_id IS
      'v62: Row-level tier override. If set, takes priority over section tier (ticket_tier_id).';
  END IF;

  -- 4. promo_code_lock: Seat is hidden/locked until this promo code is entered
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats'
      AND column_name = 'promo_code_lock'
  ) THEN
    ALTER TABLE public.seats
      ADD COLUMN promo_code_lock TEXT DEFAULT NULL;
    COMMENT ON COLUMN seats.promo_code_lock IS
      'v62: If set, seat is hidden until this promo code is entered by the buyer.';
  END IF;

  -- 5. notes: Admin-only notes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats'
      AND column_name = 'notes'
  ) THEN
    ALTER TABLE public.seats
      ADD COLUMN notes TEXT DEFAULT NULL;
    COMMENT ON COLUMN seats.notes IS
      'v62: Admin-only notes (e.g., Near exit, Obstructed view, Wheelchair space).';
  END IF;

  -- 6. custom_row_name: Display name override for the row
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats'
      AND column_name = 'custom_row_name'
  ) THEN
    ALTER TABLE public.seats
      ADD COLUMN custom_row_name TEXT DEFAULT NULL;
    COMMENT ON COLUMN seats.custom_row_name IS
      'v62: Custom display name for the row (e.g., VIP Row 1 instead of A).';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════
-- SECTION 2: CHECK CONSTRAINT — seat_category enum values
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'seats_seat_category_check'
      AND conrelid = 'public.seats'::regclass
  ) THEN
    ALTER TABLE public.seats
      ADD CONSTRAINT seats_seat_category_check
      CHECK (seat_category IN (
        'standard', 'vip', 'premium',
        'accessible', 'restricted_view', 'companion'
      ));
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════
-- SECTION 3: INDEXES — Performance for new columns
-- ════════════════════════════════════════════════════════════

-- Index for seat_category queries (filter by category on the map)
CREATE INDEX IF NOT EXISTS idx_seats_seat_category
  ON seats(seat_category)
  WHERE seat_category != 'standard';

-- Index for row_tier_id lookups (join optimization)
CREATE INDEX IF NOT EXISTS idx_seats_row_tier_id
  ON seats(row_tier_id)
  WHERE row_tier_id IS NOT NULL;

-- Index for promo_code_lock filtering (show/hide locked seats)
CREATE INDEX IF NOT EXISTS idx_seats_promo_code_lock
  ON seats(promo_code_lock)
  WHERE promo_code_lock IS NOT NULL;

-- Composite index for row-level tier queries
-- (find all seats in a section+row to apply row_tier_id)
CREATE INDEX IF NOT EXISTS idx_seats_section_row
  ON seats(venue_map_id, section_key, row_label);


-- ════════════════════════════════════════════════════════════
-- SECTION 4: RPC — get_seat_map() (UPDATED)
-- ════════════════════════════════════════════════════════════
-- Changes from v34:
--   ✓ Returns all 6 new columns
--   ✓ Adds effective_price using COALESCE hierarchy:
--       seat price_override → row_tier price → section tier price → 0
--   ✓ Adds effective_tier_id and effective_tier_name
--   ✓ Preserves all existing columns (backward compatible)
--   ✓ LEFT JOINs the row_tier for price resolution

DROP FUNCTION IF EXISTS get_seat_map(UUID);

CREATE OR REPLACE FUNCTION get_seat_map(p_event_id UUID)
RETURNS TABLE(
  -- Original columns (backward compatible)
  seat_id           UUID,
  section_key       TEXT,
  row_label         TEXT,
  seat_number       TEXT,
  status            TEXT,
  tier_id           UUID,
  tier_name         TEXT,
  tier_price        DECIMAL,
  -- v62: Effective pricing (COALESCE hierarchy)
  effective_price   DECIMAL,
  effective_tier_id UUID,
  effective_tier_name TEXT,
  -- v62: New seat properties
  price_override    DECIMAL,
  seat_category     TEXT,
  row_tier_id       UUID,
  row_tier_name     TEXT,
  row_tier_price    DECIMAL,
  promo_code_lock   TEXT,
  notes             TEXT,
  custom_row_name   TEXT
) AS $func$
BEGIN
  RETURN QUERY
  SELECT
    -- Original columns
    s.id,
    s.section_key,
    s.row_label,
    s.seat_number,
    s.status,
    s.ticket_tier_id,                                        -- section-level tier
    COALESCE(section_tier.name, 'Unassigned')::TEXT,
    COALESCE(section_tier.price, 0)::DECIMAL,

    -- v62: Effective price = seat override → row tier → section tier → 0
    COALESCE(
      s.price_override,
      row_tier.price,
      section_tier.price,
      0
    )::DECIMAL AS effective_price,

    -- v62: Effective tier = row tier → section tier
    COALESCE(s.row_tier_id, s.ticket_tier_id) AS effective_tier_id,

    -- v62: Effective tier name
    COALESCE(
      row_tier.name,
      section_tier.name,
      'Unassigned'
    )::TEXT AS effective_tier_name,

    -- v62: New properties
    s.price_override,
    COALESCE(s.seat_category, 'standard')::TEXT,
    s.row_tier_id,
    row_tier.name::TEXT AS row_tier_name,
    row_tier.price::DECIMAL AS row_tier_price,
    s.promo_code_lock,
    s.notes,
    s.custom_row_name

  FROM seats s
  JOIN venue_maps vm ON vm.id = s.venue_map_id
  LEFT JOIN ticket_tiers section_tier ON section_tier.id = s.ticket_tier_id
  LEFT JOIN ticket_tiers row_tier     ON row_tier.id = s.row_tier_id
  WHERE vm.event_id = p_event_id
  ORDER BY s.section_key, s.row_label, s.seat_number;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public;


-- ════════════════════════════════════════════════════════════
-- SECTION 5: RPC — reserve_seats() (UPDATED)
-- ════════════════════════════════════════════════════════════
-- Changes from v36:
--   ✓ REMOVED same-tier constraint (seats can now have different
--     effective tiers due to row_tier_id overrides)
--   ✓ p_tier_id kept for backward compatibility but NOT enforced
--     in the seat lock query
--   ✓ Validates: seats available, not blocked, not expired
--   ✓ Still uses FOR UPDATE SKIP LOCKED for atomicity
--   ✓ Still uses 35-minute TTL (Q-2 alignment)
--   ✓ Orphan seat check preserved (Phase 4 / BRD Section 22)
--   ✓ Returns effective_price per seat and total in response
--   ✓ Stores first effective tier in reservation (for backward compat)

DROP FUNCTION IF EXISTS reserve_seats(UUID, UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_seats(
  p_user_id  UUID,
  p_seat_ids UUID[],
  p_tier_id  UUID          -- Kept for backward compat; not used for filtering
)
RETURNS JSONB AS $func$
DECLARE
  v_seat_count      INT;
  v_locked_ids      UUID[];
  v_locked_count    INT;
  v_reservation_id  UUID;
  v_expires         TIMESTAMPTZ;
  v_event_id        UUID;
  v_event_title     TEXT;
  v_orphan          RECORD;
  v_seat_prices     JSONB;
  v_total_price     DECIMAL(10,2);
  v_primary_tier_id UUID;
  v_primary_tier_name TEXT;
BEGIN
  -- 1. Validate input
  v_seat_count := array_length(p_seat_ids, 1);

  IF v_seat_count IS NULL OR v_seat_count < 1 THEN
    RAISE EXCEPTION 'At least 1 seat must be selected';
  END IF;

  IF v_seat_count > 10 THEN
    RAISE EXCEPTION 'Cannot reserve more than 10 seats at once';
  END IF;

  -- 2. Resolve event from the first seat (all seats must be in the same event)
  SELECT vm.event_id, e.title
  INTO v_event_id, v_event_title
  FROM seats s
  JOIN venue_maps vm ON vm.id = s.venue_map_id
  JOIN events e ON e.id = vm.event_id
  WHERE s.id = p_seat_ids[1];

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Seat not found or not linked to an event';
  END IF;

  -- 3. ══ ORPHAN CHECK (Phase 4 — BRD Section 22) ══
  --    Run BEFORE locking to fail fast
  SELECT * INTO v_orphan
  FROM check_orphan_seats(p_seat_ids)
  WHERE has_orphan = true
  LIMIT 1;

  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot reserve: would leave isolated seat at Row %, Seat % (Section %). Please select adjacent seats.',
      v_orphan.orphan_row, v_orphan.orphan_seat, v_orphan.orphan_section;
  END IF;

  -- 4. ══ ATOMIC LOCK ══
  --    v62 CHANGE: Removed `s.ticket_tier_id = p_tier_id` filter.
  --    Seats can now have different effective tiers (via row_tier_id),
  --    so we no longer require all seats to belong to the same tier.
  --    We only check: seat exists in our list AND is available.
  SELECT array_agg(locked.id)
  INTO v_locked_ids
  FROM (
    SELECT s.id
    FROM seats s
    WHERE s.id = ANY(p_seat_ids)
      AND s.status = 'available'
    FOR UPDATE SKIP LOCKED
  ) AS locked;

  v_locked_count := COALESCE(array_length(v_locked_ids, 1), 0);

  -- All-or-nothing check (atomic — no TOCTOU gap)
  IF v_locked_count != v_seat_count THEN
    RAISE EXCEPTION 'One or more selected seats are no longer available. Please refresh and try again.';
  END IF;

  -- 5. Compute per-seat effective prices and total
  --    Price hierarchy: price_override → row_tier price → section_tier price → 0
  SELECT
    jsonb_agg(jsonb_build_object(
      'seat_id',        s.id,
      'section_key',    s.section_key,
      'row_label',      s.row_label,
      'seat_number',    s.seat_number,
      'effective_price', COALESCE(s.price_override, rt.price, st.price, 0),
      'effective_tier',  COALESCE(s.row_tier_id, s.ticket_tier_id)
    )),
    COALESCE(SUM(COALESCE(s.price_override, rt.price, st.price, 0)), 0)
  INTO v_seat_prices, v_total_price
  FROM seats s
  LEFT JOIN ticket_tiers st ON st.id = s.ticket_tier_id
  LEFT JOIN ticket_tiers rt ON rt.id = s.row_tier_id
  WHERE s.id = ANY(v_locked_ids);

  -- 6. Determine the primary tier for the reservation row
  --    Use p_tier_id if provided, otherwise use the first seat's effective tier
  IF p_tier_id IS NOT NULL THEN
    v_primary_tier_id := p_tier_id;
    SELECT tt.name INTO v_primary_tier_name
    FROM ticket_tiers tt WHERE tt.id = p_tier_id;
  ELSE
    -- Fall back to the effective tier of the first locked seat
    SELECT COALESCE(s.row_tier_id, s.ticket_tier_id)
    INTO v_primary_tier_id
    FROM seats s WHERE s.id = v_locked_ids[1];

    SELECT tt.name INTO v_primary_tier_name
    FROM ticket_tiers tt WHERE tt.id = v_primary_tier_id;
  END IF;

  -- 7. Create reservation row
  --    35-minute TTL (Q-2 alignment with Stripe session)
  v_expires := now() + INTERVAL '35 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, v_primary_tier_id, v_seat_count, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  -- 8. Mark seats as reserved and link to the reservation
  UPDATE seats
  SET status         = 'reserved',
      reservation_id = v_reservation_id,
      locked_until   = v_expires
  WHERE id = ANY(v_locked_ids);

  -- 9. Return reservation details with per-seat pricing
  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'expires_at',     v_expires,
    'seats_locked',   v_locked_count,
    'tier_name',      COALESCE(v_primary_tier_name, 'Mixed'),
    'tier_price',     v_total_price,                      -- total, not per-seat
    'total_price',    v_total_price,                      -- explicit total
    'event_id',       v_event_id,
    'event_title',    v_event_title,
    'seat_prices',    v_seat_prices                       -- per-seat breakdown
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;


-- ════════════════════════════════════════════════════════════
-- SECTION 6: RPC — reserve_guest_seats() (UPDATED)
-- ════════════════════════════════════════════════════════════
-- Delegates to the updated reserve_seats() with NULL user_id.
-- Unchanged pattern — just ensure we DROP + CREATE with the
-- same signature so the old definition is replaced.

DROP FUNCTION IF EXISTS reserve_guest_seats(UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_guest_seats(
  p_seat_ids UUID[],
  p_tier_id  UUID
)
RETURNS JSONB AS $func$
BEGIN
  -- Delegate to reserve_seats with NULL user_id (guest checkout)
  RETURN reserve_seats(NULL, p_seat_ids, p_tier_id);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;


-- ════════════════════════════════════════════════════════════
-- SECTION 7: RPC — calculate_seated_breakdown() (NEW)
-- ════════════════════════════════════════════════════════════
-- A specialized price breakdown engine for seated checkouts.
-- Unlike calculate_order_breakdown() (which takes a single
-- tier_id + quantity), this takes an array of specific seat IDs
-- and computes per-seat effective prices.
--
-- Price hierarchy per seat:
--   1. seat.price_override          (highest priority)
--   2. row_tier.price               (via seat.row_tier_id)
--   3. section_tier.price           (via seat.ticket_tier_id)
--   4. 0                            (fallback)
--
-- Promo code: Validated against the event's promo_codes table.
--   - percentage: applied to the subtotal
--   - fixed: capped at the subtotal
--
-- Tax + Platform fee: Uses the same 3-tier commission hierarchy
-- as calculate_order_breakdown() (Event → Organizer → Platform).

DROP FUNCTION IF EXISTS calculate_seated_breakdown(UUID[], TEXT);

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

  -- ── 5. Apply promo code discount ──
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


-- ════════════════════════════════════════════════════════════
-- SECTION 8: GRANTS (idempotent)
-- ════════════════════════════════════════════════════════════

-- get_seat_map: Both authenticated users and anonymous (public map view)
GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO anon;

-- reserve_seats: Authenticated users only
GRANT EXECUTE ON FUNCTION reserve_seats(UUID, UUID[], UUID) TO authenticated;

-- reserve_guest_seats: Both (called via Edge Function with service_role)
GRANT EXECUTE ON FUNCTION reserve_guest_seats(UUID[], UUID) TO authenticated, anon;

-- calculate_seated_breakdown: Both (needed for guest checkout price preview)
GRANT EXECUTE ON FUNCTION calculate_seated_breakdown(UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_seated_breakdown(UUID[], TEXT) TO anon;


-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v62 COMPLETE
-- ════════════════════════════════════════════════════════════
--
-- Schema changes:
--   ✓ seats.price_override     DECIMAL(10,2) DEFAULT NULL
--   ✓ seats.seat_category      TEXT DEFAULT 'standard' (with CHECK)
--   ✓ seats.row_tier_id        UUID REFERENCES ticket_tiers(id) ON DELETE SET NULL
--   ✓ seats.promo_code_lock    TEXT DEFAULT NULL
--   ✓ seats.notes              TEXT DEFAULT NULL
--   ✓ seats.custom_row_name    TEXT DEFAULT NULL
--
-- Indexes added:
--   ✓ idx_seats_seat_category   (partial: non-standard only)
--   ✓ idx_seats_row_tier_id     (partial: non-null only)
--   ✓ idx_seats_promo_code_lock (partial: non-null only)
--   ✓ idx_seats_section_row     (composite for row lookups)
--
-- RPCs updated:
--   ✓ get_seat_map(event_id)
--     — Returns new columns + effective pricing
--   ✓ reserve_seats(user_id, seat_ids[], tier_id)
--     — Removed same-tier constraint; returns per-seat prices
--   ✓ reserve_guest_seats(seat_ids[], tier_id)
--     — Delegates to updated reserve_seats
--   ✓ calculate_seated_breakdown(seat_ids[], promo_code)
--     — NEW: per-seat price breakdown with tax/fees/promo
--
-- Verification:
--
--   -- 1. Check new columns exist:
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'seats'
--     AND column_name IN (
--       'price_override', 'seat_category', 'row_tier_id',
--       'promo_code_lock', 'notes', 'custom_row_name'
--     );
--
--   -- 2. Test get_seat_map (should now return effective_price):
--   SELECT seat_id, effective_price, effective_tier_name, seat_category
--   FROM get_seat_map('<event_id>');
--
--   -- 3. Test reserve_seats with mixed tiers (should NOT error):
--   SELECT reserve_seats('<user_id>', ARRAY['<seat_1>', '<seat_2>']::UUID[], '<any_tier>');
--
--   -- 4. Test calculate_seated_breakdown:
--   SELECT calculate_seated_breakdown(ARRAY['<seat_1>', '<seat_2>']::UUID[], NULL);
--
--   -- 5. Test with promo code:
--   SELECT calculate_seated_breakdown(ARRAY['<seat_1>']::UUID[], 'SAVE10');
--
--   -- 6. Verify seat_category CHECK constraint:
--   -- (Should fail with CHECK violation)
--   -- UPDATE seats SET seat_category = 'invalid' WHERE id = '<seat_id>';
