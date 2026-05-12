-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v27 Phase 7 Task 3
-- request_payout RPC: Race-condition-safe payout requests
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates/replaces function only. Idempotent.
--
-- BRD Section 8:
--   "يجب أن يتمكن المنظم من طلب سحب الأرباح المتاحة"
--   "يجب منع السحب من الرصيد المعلق (قبل انتهاء الحدث)"
--   "يجب منع التكرار أو السحب فوق الرصيد"
--
-- Security Architecture:
--   1. auth.uid() → organizer resolution
--   2. SELECT ... FOR UPDATE → row-level lock (prevents race)
--   3. Recalculate available balance inside the lock
--   4. Validate amount <= available_balance
--   5. INSERT into payouts with status 'pending'
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: request_payout RPC ════════════

CREATE OR REPLACE FUNCTION request_payout(p_amount DECIMAL)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_payout_method TEXT;
  v_payout_dest TEXT;
  v_currency TEXT := 'USD';

  -- Balance calculation
  v_net_revenue DECIMAL(12,2) := 0;
  v_refunded DECIMAL(12,2) := 0;
  v_pending_balance DECIMAL(12,2) := 0;
  v_available_gross DECIMAL(12,2) := 0;
  v_total_paid DECIMAL(12,2) := 0;
  v_total_requested DECIMAL(12,2) := 0;
  v_available_balance DECIMAL(12,2) := 0;
  v_escrow_cutoff TIMESTAMPTZ := now() - interval '3 days';

  -- Result
  v_payout_id UUID;
BEGIN
  -- ════════════ VALIDATION ════════════

  -- 1. Amount must be positive
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than 0');
  END IF;

  -- 2. Amount precision check (max 2 decimal places)
  IF p_amount != ROUND(p_amount, 2) THEN
    RETURN jsonb_build_object('error', 'Amount must have at most 2 decimal places');
  END IF;

  -- ════════════ LOCK ORGANIZER ROW ════════════
  -- FOR UPDATE prevents concurrent payout requests from
  -- calculating stale available balances.

  SELECT id, payout_method,
    CASE
      WHEN payout_method = 'bank' THEN 'Bank •••' || RIGHT(COALESCE(bank_account_number, ''), 4)
      WHEN payout_method = 'paypal' THEN COALESCE(paypal_email, '')
      WHEN payout_method = 'stripe_connect' THEN COALESCE(stripe_account_id, '')
      ELSE 'Unknown'
    END
  INTO v_org_id, v_payout_method, v_payout_dest
  FROM organizers
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No organizer profile found. Please complete your profile first.');
  END IF;

  -- ════════════ CALCULATE AVAILABLE BALANCE ════════════
  -- Mirrors get_organizer_financials logic exactly.

  -- Net revenue (all-time paid payments)
  SELECT
    COALESCE(SUM(p.organizer_net), 0),
    COALESCE(MAX(p.currency), 'USD')
  INTO v_net_revenue, v_currency
  FROM payments p
  WHERE p.organizer_id = v_org_id
    AND p.status = 'paid';

  -- Subtract refunds
  SELECT COALESCE(SUM(p.organizer_net), 0)
  INTO v_refunded
  FROM payments p
  WHERE p.organizer_id = v_org_id
    AND p.status IN ('refunded', 'partially_refunded');

  v_net_revenue := v_net_revenue - v_refunded;
  IF v_net_revenue < 0 THEN v_net_revenue := 0; END IF;

  -- Pending balance (escrow: events < 3 days after end)
  SELECT COALESCE(SUM(p.organizer_net), 0)
  INTO v_pending_balance
  FROM payments p
  JOIN events e ON e.id = p.event_id
  WHERE p.organizer_id = v_org_id
    AND p.status = 'paid'
    AND e.date > v_escrow_cutoff;

  -- Available gross = released funds
  v_available_gross := v_net_revenue - v_pending_balance;
  IF v_available_gross < 0 THEN v_available_gross := 0; END IF;

  -- Already paid or requested payouts
  SELECT
    COALESCE(SUM(CASE WHEN po.status = 'completed' THEN po.net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN po.status IN ('pending', 'processing') THEN po.net_amount ELSE 0 END), 0)
  INTO v_total_paid, v_total_requested
  FROM payouts po
  WHERE po.organizer_id = v_org_id;

  -- Available balance = released - paid - requested
  v_available_balance := v_available_gross - v_total_paid - v_total_requested;
  IF v_available_balance < 0 THEN v_available_balance := 0; END IF;

  -- ════════════ BALANCE CHECK ════════════

  IF p_amount > v_available_balance THEN
    RETURN jsonb_build_object(
      'error', 'Insufficient available balance',
      'requested', p_amount,
      'available', v_available_balance
    );
  END IF;

  -- ════════════ CREATE PAYOUT REQUEST ════════════

  INSERT INTO payouts (
    organizer_id,
    gross_amount,
    platform_fees,
    tax_collected,
    net_amount,
    currency,
    payout_method,
    payout_destination,
    status,
    requested_at
  ) VALUES (
    v_org_id,
    p_amount,       -- For simplicity, net_amount = requested amount
    0,              -- Fees already deducted in organizer_net
    0,              -- Tax already deducted in organizer_net
    p_amount,
    v_currency,
    v_payout_method,
    v_payout_dest,
    'pending',
    now()
  )
  RETURNING id INTO v_payout_id;

  -- ════════════ RETURN ════════════

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'amount', p_amount,
    'currency', v_currency,
    'status', 'pending',
    'remaining_balance', v_available_balance - p_amount,
    'message', 'Payout request submitted. Our team will process it within 3-5 business days.'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 2: Grant access ════════════
GRANT EXECUTE ON FUNCTION request_payout(DECIMAL) TO authenticated;


-- ════════════ ✅ MIGRATION v27 TASK 3 COMPLETE ════════════
--
-- RPC created:
--   ✓ request_payout(p_amount DECIMAL) → JSONB
--
-- Race condition protection:
--   ✓ SELECT ... FOR UPDATE on organizers row
--   ✓ Balance recalculated INSIDE the lock
--   ✓ No TOCTOU vulnerability
--
-- Validation:
--   ✓ Amount > 0
--   ✓ Amount has ≤ 2 decimal places
--   ✓ Amount ≤ available_balance
--   ✓ Organizer must exist
--
-- Test:
--   SELECT request_payout(100.00);
