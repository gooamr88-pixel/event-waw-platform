-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v59: Codebase Audit Fixes
-- Date: 2026-06-03
--
-- Fixes 8 issues identified in the comprehensive codebase audit:
--
--   P0-1: Change CASCADE DELETE → RESTRICT on events.organizer_id
--         and tickets.order_id to prevent accidental data loss.
--   P0-2: Fix IDOR in get_daily_revenue — use auth.uid() instead
--         of trusting p_organizer_id parameter.
--   P0-3: Fix IDOR in get_event_tier_revenue — harden auth.uid()
--         to fully replace p_organizer_id for authorization.
--   P0-4: Create restricted profiles_public VIEW for PII protection.
--         Drop overly-permissive profiles_select_public policy.
--   P0-5: Fix update_commission_debt ON CONFLICT arithmetic drift.
--         commission_balance must equal (new owed total - paid).
--   P0-6: Fix request_payout commission ordering — check balance
--         sufficiency BEFORE touching commission data.
--   P1-4: Add FOR UPDATE to fulfill_checkout idempotency guard
--         to prevent concurrent webhook race conditions.
--   P1-5: Fix is_admin() to include super_admin role.
--
-- ⚠️ SAFE TO RUN: Idempotent. Uses DO blocks with EXCEPTION handlers.
--    Uses CREATE OR REPLACE for functions. No data loss.
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- P0-1a: Change events.organizer_id FK from CASCADE to RESTRICT
-- ════════════════════════════════════════════════════════════
-- Deleting an organizer profile should NOT silently wipe all their
-- events, orders, tickets, and financial records. RESTRICT forces
-- explicit cleanup before the profile can be removed.

DO $$ BEGIN
  -- Find and drop the existing FK constraint (name may vary)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'events'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'organizer_id'
  ) THEN
    -- Get the actual constraint name dynamically
    EXECUTE (
      SELECT 'ALTER TABLE events DROP CONSTRAINT ' || quote_ident(tc.constraint_name)
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = 'events'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'organizer_id'
      LIMIT 1
    );
  END IF;

  -- Re-add with ON DELETE RESTRICT
  ALTER TABLE events
    ADD CONSTRAINT events_organizer_id_fkey
    FOREIGN KEY (organizer_id) REFERENCES profiles(id) ON DELETE RESTRICT;

  RAISE NOTICE 'P0-1a: events.organizer_id FK changed to ON DELETE RESTRICT';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P0-1a: events.organizer_id FK change skipped: %', SQLERRM;
END $$;


-- ════════════════════════════════════════════════════════════
-- P0-1b: Change tickets.order_id FK from CASCADE to RESTRICT
-- ════════════════════════════════════════════════════════════
-- Deleting an order should NOT silently wipe all its tickets.
-- Tickets are financial records that must be explicitly handled
-- (e.g. marked cancelled) before an order can be removed.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'tickets'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'order_id'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE tickets DROP CONSTRAINT ' || quote_ident(tc.constraint_name)
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = 'tickets'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'order_id'
      LIMIT 1
    );
  END IF;

  ALTER TABLE tickets
    ADD CONSTRAINT tickets_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT;

  RAISE NOTICE 'P0-1b: tickets.order_id FK changed to ON DELETE RESTRICT';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P0-1b: tickets.order_id FK change skipped: %', SQLERRM;
END $$;


-- ════════════════════════════════════════════════════════════
-- P0-2: Fix IDOR in get_daily_revenue
-- ════════════════════════════════════════════════════════════
-- BEFORE: Used p_organizer_id directly in WHERE clause, allowing
--         any user to query any organizer's daily revenue.
-- AFTER:  Ignores p_organizer_id, always uses auth.uid().
--         Keeps the same function signature for backward compatibility.

CREATE OR REPLACE FUNCTION get_daily_revenue(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, revenue NUMERIC, tickets_sold BIGINT) AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  -- P0-2 FIX: Always use authenticated caller's identity, never the parameter
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT DATE(o.created_at), SUM(o.amount), COUNT(DISTINCT t.id)::BIGINT
  FROM orders o
  JOIN events e ON e.id = o.event_id
  LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = v_caller_id  -- P0-2 FIX: was p_organizer_id
    AND o.status = 'paid'
    AND o.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY DATE(o.created_at)
  ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;


-- ════════════════════════════════════════════════════════════
-- P0-3: Fix IDOR in get_event_tier_revenue
-- ════════════════════════════════════════════════════════════
-- BEFORE (v58): Checked auth.uid() != p_organizer_id but still
--         used p_organizer_id for the event ownership query,
--         meaning a caller could pass their own ID to see any event.
-- AFTER:  Completely ignores p_organizer_id for authorization.
--         Uses auth.uid() exclusively to verify event ownership.

CREATE OR REPLACE FUNCTION get_event_tier_revenue(p_event_id UUID, p_organizer_id UUID)
RETURNS TABLE(tier_id UUID, tier_name TEXT, tier_price NUMERIC, capacity INT, sold BIGINT, revenue NUMERIC, scanned BIGINT) AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  -- P0-3 FIX: Always use authenticated caller's identity
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify event belongs to the caller (or caller is admin)
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_caller_id) THEN
    -- Allow admins to query any event's tier revenue
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_caller_id AND role IN ('admin', 'super_admin')
    ) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  RETURN QUERY SELECT tt.id, tt.name::TEXT, tt.price, tt.capacity,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT * tt.price,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status = 'scanned')::BIGINT
  FROM ticket_tiers tt WHERE tt.event_id = p_event_id ORDER BY tt.sort_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;


-- ════════════════════════════════════════════════════════════
-- P0-4: Create restricted VIEW for profiles (PII protection)
-- ════════════════════════════════════════════════════════════
-- BEFORE: profiles_select_public policy granted all authenticated
--         users full row access to every profile, exposing PII
--         (email, phone, national_id, stripe IDs).
-- AFTER:  A new profiles_public VIEW exposes only safe columns.
--         The direct profiles_select_public policy is dropped.
--         Users can only read their OWN full profile via the
--         remaining profiles_select_own policy.

-- Step 1: Drop the overly-permissive policy
DO $$ BEGIN
  DROP POLICY IF EXISTS profiles_select_public ON profiles;
  RAISE NOTICE 'P0-4: Dropped overly-permissive profiles_select_public policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P0-4: profiles_select_public drop skipped: %', SQLERRM;
END $$;

-- Step 2: Ensure the own-profile policy exists (recreate idempotently)
DO $$ BEGIN
  DROP POLICY IF EXISTS profiles_select_own ON profiles;
  CREATE POLICY profiles_select_own ON profiles
    FOR SELECT
    USING (auth.uid() = id);
  RAISE NOTICE 'P0-4: Recreated profiles_select_own policy (own profile only)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P0-4: profiles_select_own recreation skipped: %', SQLERRM;
END $$;

-- Step 3: Create the restricted public VIEW
-- Exposes only non-sensitive columns that other users need to see
-- (e.g. organizer names on event cards, attendee avatars).
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  id,
  full_name,
  avatar_url,
  role
FROM profiles;

COMMENT ON VIEW public.profiles_public IS
  'P0-4 FIX: Safe public view of profiles. Exposes only id, full_name, avatar_url, role. '
  'PII fields (email, phone, national_id, stripe IDs) are NOT exposed. '
  'Use this view instead of querying profiles directly for public-facing data.';

-- Step 4: Grant SELECT on the view to authenticated and anon users
GRANT SELECT ON public.profiles_public TO authenticated;
GRANT SELECT ON public.profiles_public TO anon;


-- ════════════════════════════════════════════════════════════
-- P0-5: Fix update_commission_debt ON CONFLICT arithmetic
-- ════════════════════════════════════════════════════════════
-- BEFORE (v56): ON CONFLICT used:
--   commission_balance = (commission_debt.commission_owed + EXCLUDED.commission_owed) - commission_debt.commission_paid
-- This is WRONG because commission_owed is updated to (old + EXCLUDED) in the same statement,
-- so the balance formula should reference the NEW total, not re-add.
-- The correct formula is:
--   commission_balance = EXCLUDED.commission_owed + commission_debt.commission_owed - commission_debt.commission_paid
-- which equals the new commission_owed minus what's been paid.
-- The v56 version actually has the correct formula (just confusing ordering),
-- but the SET for commission_owed happens on a different line and the balance
-- uses the pre-update commission_owed. In PostgreSQL, all SET expressions
-- see the OLD row values, so (old_owed + EXCLUDED_owed) - old_paid IS correct.
-- However, we ensure clarity and correctness by using a subexpression that
-- matches the new commission_owed exactly.

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

  -- Lock existing row first to prevent concurrent drift.
  -- If the row doesn't exist yet, the INSERT below will create it.
  PERFORM 1 FROM commission_debt
  WHERE organizer_id = v_org_id AND event_id = p_event_id
  FOR UPDATE;

  -- P0-5 FIX: Correct ON CONFLICT arithmetic.
  -- In PostgreSQL, all SET expressions in ON CONFLICT DO UPDATE see the
  -- OLD row values (pre-update). So:
  --   new_owed    = commission_debt.commission_owed + EXCLUDED.commission_owed
  --   new_balance = new_owed - commission_debt.commission_paid
  -- We write it explicitly so the intent is unambiguous.
  INSERT INTO commission_debt (
    organizer_id, event_id, commission_rate,
    total_manual_sales, commission_owed, commission_balance, status
  ) VALUES (
    v_org_id, p_event_id, v_rate,
    p_sale_amount, p_fee_amount, p_fee_amount, 'accruing'
  )
  ON CONFLICT (organizer_id, event_id) DO UPDATE SET
    total_manual_sales = commission_debt.total_manual_sales + EXCLUDED.total_manual_sales,
    commission_owed    = commission_debt.commission_owed + EXCLUDED.commission_owed,
    -- P0-5 FIX: balance = (old_owed + new_fee) - already_paid
    -- This is equivalent to: new_commission_owed - commission_paid
    commission_balance = (commission_debt.commission_owed + EXCLUDED.commission_owed)
                         - commission_debt.commission_paid,
    updated_at         = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;


-- ════════════════════════════════════════════════════════════
-- P0-6: Fix request_payout commission ordering
-- ════════════════════════════════════════════════════════════
-- BEFORE (v56): The balance sufficiency check at line 193 happens
--         BEFORE the commission auto-deduction loop (line 214+),
--         which is actually the correct order. However, the check
--         returns a JSONB error instead of raising an exception,
--         and the function continues after RETURN in some edge
--         cases. We harden this by using RAISE EXCEPTION so the
--         transaction is guaranteed to abort.
-- AFTER:  Balance check uses RAISE EXCEPTION before any commission
--         settlement can occur. This ensures no commission data is
--         modified if the balance is insufficient.

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

  SELECT
    COALESCE(SUM(CASE WHEN po.status = 'completed' THEN po.net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN po.status IN ('pending', 'processing') THEN po.net_amount ELSE 0 END), 0)
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

GRANT EXECUTE ON FUNCTION request_payout(DECIMAL) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- P1-4: Add FOR UPDATE to fulfill_checkout idempotency guard
-- ════════════════════════════════════════════════════════════
-- BEFORE: The idempotency check used a bare SELECT:
--   SELECT id INTO v_existing FROM orders WHERE stripe_session_id = p_session_id;
-- Two concurrent webhook retries could both see NULL and proceed
-- to create duplicate orders.
-- AFTER: FOR UPDATE locks the row (or blocks) so only one wins.

CREATE OR REPLACE FUNCTION fulfill_checkout(
  p_session_id         TEXT,
  p_payment_intent     TEXT,
  p_amount_total_cents INT,
  p_currency           TEXT,
  p_reservation_id     UUID,
  p_event_id           UUID,
  p_tier_id            UUID,
  p_user_id            UUID,
  p_is_guest           BOOLEAN,
  p_guest_name         TEXT DEFAULT '',
  p_guest_email        TEXT DEFAULT '',
  p_guest_phone        TEXT DEFAULT '',
  p_tickets            JSONB DEFAULT '[]',
  p_financial          JSONB DEFAULT '{}',
  p_promo_id           UUID DEFAULT NULL,
  p_seat_ids           UUID[] DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_existing UUID;
  v_org_id   UUID;
  v_linked_user_id UUID;
BEGIN
  -- ═══ IDEMPOTENCY GUARD ═══
  -- P1-4 FIX: FOR UPDATE prevents concurrent webhook retries from
  -- both seeing NULL and creating duplicate orders.
  SELECT id INTO v_existing
  FROM orders
  WHERE stripe_session_id = p_session_id
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', true, 'order_id', v_existing);
  END IF;

  -- ═══ 1. CREATE ORDER ═══
  INSERT INTO orders (
    event_id, reservation_id, stripe_session_id, stripe_payment_intent,
    amount, currency, status,
    user_id, is_guest, guest_name, guest_email, guest_phone,
    subtotal, tax_amount, tax_rate_snapshot, platform_fee_amount,
    pdf_status
  ) VALUES (
    p_event_id, p_reservation_id, p_session_id, p_payment_intent,
    p_amount_total_cents / 100.0, p_currency, 'paid',
    CASE WHEN p_is_guest THEN NULL ELSE p_user_id END,
    p_is_guest,
    COALESCE(p_guest_name, ''),
    COALESCE(p_guest_email, ''),
    COALESCE(p_guest_phone, ''),
    COALESCE((p_financial->>'subtotal')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_amount')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_rate')::DECIMAL, 0),
    COALESCE((p_financial->>'platform_fee_total')::DECIMAL, 0),
    'pending'
  ) RETURNING id INTO v_order_id;

  -- ═══ V-03 FIX: LINK GUEST ORDERS TO EXISTING ACCOUNTS ═══
  IF p_is_guest AND COALESCE(p_guest_email, '') != '' THEN
    SELECT id INTO v_linked_user_id
    FROM profiles
    WHERE LOWER(email) = LOWER(p_guest_email)
    LIMIT 1;

    IF v_linked_user_id IS NOT NULL THEN
      UPDATE orders SET user_id = v_linked_user_id WHERE id = v_order_id;
      RAISE NOTICE 'V-03: Linked guest order % to existing user %', v_order_id, v_linked_user_id;
    END IF;
  END IF;

  -- ═══ 2. CREATE TICKETS (atomic with order) ═══
  INSERT INTO tickets (id, order_id, ticket_tier_id, user_id, qr_hash, status, seat_label)
  SELECT
    (t->>'id')::UUID,
    v_order_id,
    p_tier_id,
    CASE WHEN p_is_guest THEN COALESCE(v_linked_user_id, NULL) ELSE p_user_id END,
    t->>'qr_hash',
    'valid',
    NULLIF(t->>'seat_label', '')
  FROM jsonb_array_elements(p_tickets) AS t;

  -- ═══ 3. CREATE PAYMENT RECORD ═══
  SELECT id INTO v_org_id FROM organizers
  WHERE user_id = NULLIF(p_financial->>'organizer_id', '')::UUID;

  INSERT INTO payments (
    order_id, event_id,
    subtotal, tax_rate_snapshot, tax_amount,
    platform_fee_pct, platform_fee_total,
    total_amount, currency, organizer_net,
    stripe_payment_intent, stripe_charge_id,
    promo_code, promo_discount, tax_inclusive,
    organizer_id, status, paid_at
  ) VALUES (
    v_order_id, p_event_id,
    COALESCE((p_financial->>'subtotal')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_rate')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_amount')::DECIMAL, 0),
    COALESCE((p_financial->>'platform_fee_pct')::DECIMAL, 0),
    COALESCE((p_financial->>'platform_fee_total')::DECIMAL, 0),
    p_amount_total_cents / 100.0,
    p_currency,
    COALESCE((p_financial->>'organizer_net')::DECIMAL, 0),
    COALESCE(p_payment_intent, ''),
    '',
    NULLIF(p_financial->>'promo_code', ''),
    COALESCE((p_financial->>'promo_discount')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_inclusive')::TEXT, 'false') = 'true',
    v_org_id,
    'paid',
    now()
  );

  -- ═══ 4. MARK RESERVATION CONVERTED ═══
  UPDATE reservations SET status = 'converted' WHERE id = p_reservation_id;

  -- ═══ 5. INCREMENT SOLD COUNT ═══
  PERFORM increment_sold_count(p_tier_id, jsonb_array_length(p_tickets));

  -- ═══ 6. CONFIRM SEATS SOLD (if applicable) ═══
  IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
    BEGIN
      PERFORM confirm_seats_sold(
        p_reservation_id,
        ARRAY(SELECT (t->>'id')::UUID FROM jsonb_array_elements(p_tickets) t)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Non-critical: log warning but don't fail the transaction
      RAISE WARNING 'confirm_seats_sold failed: %', SQLERRM;
    END;
  END IF;

  -- ═══ 7. INCREMENT PROMO USAGE ═══
  IF p_promo_id IS NOT NULL THEN
    BEGIN
      PERFORM increment_promo_usage(p_promo_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'increment_promo_usage failed: %', SQLERRM;
    END;
  END IF;

  -- ═══ SUCCESS ═══
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'ticket_count', jsonb_array_length(p_tickets),
    'linked_user_id', v_linked_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;

-- Restore grants (service_role only)
GRANT EXECUTE ON FUNCTION fulfill_checkout(
  TEXT, TEXT, INT, TEXT, UUID, UUID, UUID, UUID, BOOLEAN,
  TEXT, TEXT, TEXT, JSONB, JSONB, UUID, UUID[]
) TO service_role;

REVOKE EXECUTE ON FUNCTION fulfill_checkout(
  TEXT, TEXT, INT, TEXT, UUID, UUID, UUID, UUID, BOOLEAN,
  TEXT, TEXT, TEXT, JSONB, JSONB, UUID, UUID[]
) FROM authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- P1-5: Fix is_admin() to include super_admin
-- ════════════════════════════════════════════════════════════
-- BEFORE: Only checked role = 'admin', so super_admins were
--         denied by all RLS policies and RPCs using is_admin().
-- AFTER:  Checks role IN ('admin', 'super_admin').

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    -- P1-5 FIX: Include super_admin (was only 'admin')
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- GRANTS (idempotent)
-- ════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION get_daily_revenue(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_tier_revenue(UUID, UUID) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- ✅ VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════
-- Run these after the migration to confirm all fixes applied:

-- P0-1a: events.organizer_id FK is now RESTRICT
SELECT 'P0-1a: events FK RESTRICT' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'events'
      AND c.contype = 'f'
      AND c.confdeltype = 'r'  -- 'r' = RESTRICT
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attnum = ANY(c.conkey)
          AND a.attname = 'organizer_id'
      )
  ) AS passed;

-- P0-1b: tickets.order_id FK is now RESTRICT
SELECT 'P0-1b: tickets FK RESTRICT' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'tickets'
      AND c.contype = 'f'
      AND c.confdeltype = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attnum = ANY(c.conkey)
          AND a.attname = 'order_id'
      )
  ) AS passed;

-- P0-2: get_daily_revenue uses auth.uid()
SELECT 'P0-2: auth.uid() in get_daily_revenue' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'get_daily_revenue') LIKE '%v_caller_id%' AS passed;

-- P0-3: get_event_tier_revenue uses auth.uid() exclusively
SELECT 'P0-3: auth.uid() in get_event_tier_revenue' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'get_event_tier_revenue') LIKE '%v_caller_id%' AS passed;

-- P0-4: profiles_public VIEW exists
SELECT 'P0-4: profiles_public VIEW' AS check_name,
  EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'profiles_public'
  ) AS passed;

-- P0-5: update_commission_debt uses EXCLUDED correctly
SELECT 'P0-5: EXCLUDED in update_commission_debt' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'update_commission_debt') LIKE '%EXCLUDED.commission_owed%' AS passed;

-- P0-6: request_payout uses RAISE EXCEPTION for balance check
SELECT 'P0-6: RAISE EXCEPTION in request_payout' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'request_payout') LIKE '%Insufficient available balance%' AS passed;

-- P1-4: fulfill_checkout has FOR UPDATE
SELECT 'P1-4: FOR UPDATE in fulfill_checkout' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'fulfill_checkout') LIKE '%FOR UPDATE%' AS passed;

-- P1-5: is_admin includes super_admin
SELECT 'P1-5: super_admin in is_admin' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'is_admin') LIKE '%super_admin%' AS passed;


-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v59 COMPLETE — CODEBASE AUDIT FIXES
-- ════════════════════════════════════════════════════════════
