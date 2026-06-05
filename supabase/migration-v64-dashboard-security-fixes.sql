-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v64: Organizer Dashboard Security & Logic Fixes
-- Date: 2026-06-05
--
-- ⚠️  SAFE TO RUN MULTIPLE TIMES: Fully idempotent.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════
-- 1. HARDEN create_reservation() (IDOR Fix)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_reservation(p_user_id UUID, p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE(reservation_id UUID, expires_at TIMESTAMPTZ, tier_name TEXT, tier_price DECIMAL, event_title TEXT, event_id UUID) AS $$
DECLARE v_tier RECORD; v_reservation_id UUID; v_expires TIMESTAMPTZ;
BEGIN
  -- IDOR verification: Ensure caller has authority over p_user_id
  IF p_user_id IS NOT NULL THEN
    IF auth.uid() IS NULL OR p_user_id != auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized: cannot reserve tickets on behalf of another user';
    END IF;
  END IF;

  IF p_quantity < 1 OR p_quantity > 10 THEN RAISE EXCEPTION 'Quantity must be between 1 and 10'; END IF;
  SELECT tt.id, tt.name, tt.price, tt.capacity, tt.event_id, e.title AS event_title,
    tt.capacity - COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.ticket_tier_id = tt.id AND r.status = 'active'), 0)
    - COALESCE((SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned')), 0) AS available
  INTO v_tier FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id WHERE tt.id = p_tier_id FOR UPDATE OF tt;
  IF v_tier IS NULL THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;
  IF v_tier.available < p_quantity THEN RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_tier.available; END IF;
  v_expires := NOW() + INTERVAL '32 minutes';  -- V-01 FIX: Aligned with Stripe session (was 10 min)
  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active') RETURNING id INTO v_reservation_id;
  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- 2. HARDEN reserve_seats() (IDOR Fix + 10-Minute Expiry Standardize)
-- ════════════════════════════════════════════════════════════

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
  -- IDOR verification: Ensure caller has authority over p_user_id
  IF p_user_id IS NOT NULL THEN
    IF auth.uid() IS NULL OR p_user_id != auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized: cannot reserve seats on behalf of another user';
    END IF;
  END IF;

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
  --    Standardize to 10-minute expiry to comply with BRD Rule 1
  v_expires := now() + INTERVAL '10 minutes';

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
-- 3. HARDEN request_payout() (Double-Payout Balance Bypass Fix)
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

  -- Dynamic exchange rate (replaces hardcoded 50.0)
  v_egp_usd_rate DECIMAL(14,6);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
  END IF;
  IF p_amount != ROUND(p_amount, 2) THEN
    RAISE EXCEPTION 'Amount must have at most 2 decimal places';
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

  -- Sum payouts using gross_amount instead of net_amount to properly deduct requested balances
  SELECT
    COALESCE(SUM(CASE WHEN po.status = 'completed' THEN po.gross_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN po.status IN ('pending', 'processing') THEN po.gross_amount ELSE 0 END), 0)
  INTO v_total_paid, v_total_requested
  FROM payouts po WHERE po.organizer_id = v_org.id;

  v_available_balance := v_available_gross - v_total_paid - v_total_requested;
  IF v_available_balance < 0 THEN v_available_balance := 0; END IF;

  -- ══ P0-6 FIX: BALANCE CHECK *BEFORE* COMMISSION SETTLEMENT ══
  -- RAISE EXCEPTION instead of RETURN to guarantee full rollback.
  -- This MUST happen before the commission deduction loop below
  -- to prevent partial commission settlements on failed payouts.
  IF p_amount > v_available_balance THEN
    RAISE EXCEPTION 'Insufficient available balance: requested %, available %',
      p_amount, v_available_balance;
  END IF;

  -- Build destination label
  v_payout_dest := CASE
    WHEN v_org.payout_method = 'bank' THEN 'Bank •••' || RIGHT(COALESCE(v_org.bank_account_number, ''), 4)
    WHEN v_org.payout_method = 'paypal' THEN COALESCE(v_org.paypal_email, '')
    WHEN v_org.payout_method = 'stripe_connect' THEN COALESCE(v_org.stripe_account_id, '')
    ELSE 'Unknown'
  END;

  -- ══ AUTO-DEDUCTION ENGINE ══
  -- Fetch the dynamic exchange rate once before the loop
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
      v_deduct_amount := LEAST(v_remaining_payout_amount, ROUND(v_debt.commission_balance / v_egp_usd_rate, 2));

      IF v_deduct_amount > 0 THEN
        v_remaining_payout_amount := v_remaining_payout_amount - v_deduct_amount;
        v_total_deducted := v_total_deducted + v_deduct_amount;

        -- Record settlement in EGP (usd * rate)
        INSERT INTO commission_settlements (
          debt_id, organizer_id, amount, method,
          reference, verified_at, notes
        ) VALUES (
          v_debt.id, v_org.id, ROUND(v_deduct_amount * v_egp_usd_rate, 2), 'stripe_deduction',
          'auto_payout_deduction_' || v_payout_id::text, now(),
          'Auto-deducted from Stripe payout ' || v_payout_id::text || ' ($' || v_deduct_amount || ' converted to EGP at rate ' || v_egp_usd_rate || ')'
        );

        -- Update debt record
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
$func$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;


-- ════════════════════════════════════════════════════════════
-- 4. GRANTS
-- ════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_seats(UUID, UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION request_payout(DECIMAL) TO authenticated;

COMMIT;
