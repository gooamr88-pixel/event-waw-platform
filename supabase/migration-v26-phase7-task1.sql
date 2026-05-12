-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v26 Phase 7 Task 1
-- Financial Dashboard: get_organizer_financials RPC
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates/replaces function only. Idempotent.
--
-- BRD Section 8:
--   "صفحة للمنظم تعرض: إجمالي المبيعات، الضرائب، رسوم المنصة"
--   "دعم تأخير الدفع إلى ما بعد انتهاء الحدث"
--   "المبالغ القابلة للسحب، المبالغ قيد الانتظار، المدفوعات السابقة"
--
-- Mathematical Model:
--   NET_REVENUE = SUM(payments.organizer_net) WHERE status='paid'
--   PENDING     = NET from events ending < 3 days ago (escrow)
--   AVAILABLE   = NET from events ending >= 3 days ago
--   BALANCE     = AVAILABLE - already paid/requested payouts
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: get_organizer_financials RPC ════════════

CREATE OR REPLACE FUNCTION get_organizer_financials()
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;

  -- Totals
  v_gross_sales DECIMAL(12,2) := 0;
  v_tax_collected DECIMAL(12,2) := 0;
  v_platform_fees DECIMAL(12,2) := 0;
  v_promo_discounts DECIMAL(12,2) := 0;
  v_net_revenue DECIMAL(12,2) := 0;
  v_refunded_amount DECIMAL(12,2) := 0;

  -- Balance split
  v_pending_balance DECIMAL(12,2) := 0;
  v_available_gross DECIMAL(12,2) := 0;

  -- Payouts
  v_total_paid DECIMAL(12,2) := 0;
  v_total_requested DECIMAL(12,2) := 0;
  v_available_balance DECIMAL(12,2) := 0;

  -- Escrow cutoff: 3 days after event ends
  v_escrow_cutoff TIMESTAMPTZ := now() - interval '3 days';

  -- Currency
  v_currency TEXT := 'USD';

  -- Per-event breakdown
  v_events JSONB;
  v_recent_payouts JSONB;
BEGIN
  -- Resolve organizer
  SELECT id INTO v_org_id FROM organizers WHERE user_id = v_user_id;
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'No organizer profile found',
      'has_organizer', false
    );
  END IF;

  -- ── AGGREGATE: All-time financial totals ──
  SELECT
    COALESCE(SUM(p.subtotal), 0),
    COALESCE(SUM(p.tax_amount), 0),
    COALESCE(SUM(p.platform_fee_total), 0),
    COALESCE(SUM(p.promo_discount), 0),
    COALESCE(SUM(p.organizer_net), 0),
    COALESCE(MAX(p.currency), 'USD')
  INTO v_gross_sales, v_tax_collected, v_platform_fees,
       v_promo_discounts, v_net_revenue, v_currency
  FROM payments p
  WHERE p.organizer_id = v_org_id
    AND p.status = 'paid';

  -- ── AGGREGATE: Refunded amounts ──
  SELECT COALESCE(SUM(p.organizer_net), 0)
  INTO v_refunded_amount
  FROM payments p
  WHERE p.organizer_id = v_org_id
    AND p.status IN ('refunded', 'partially_refunded');

  -- Adjust net revenue for refunds
  v_net_revenue := v_net_revenue - v_refunded_amount;
  IF v_net_revenue < 0 THEN v_net_revenue := 0; END IF;

  -- ── SPLIT: Pending vs Available ──
  -- Pending = organizer_net from events that end AFTER the escrow cutoff
  SELECT COALESCE(SUM(p.organizer_net), 0)
  INTO v_pending_balance
  FROM payments p
  JOIN events e ON e.id = p.event_id
  WHERE p.organizer_id = v_org_id
    AND p.status = 'paid'
    AND e.date > v_escrow_cutoff;

  -- Available (gross) = net revenue from events that ended BEFORE escrow cutoff
  v_available_gross := v_net_revenue - v_pending_balance;
  IF v_available_gross < 0 THEN v_available_gross := 0; END IF;

  -- ── PAYOUTS: Already paid or requested ──
  SELECT
    COALESCE(SUM(CASE WHEN po.status = 'completed' THEN po.net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN po.status IN ('pending', 'processing') THEN po.net_amount ELSE 0 END), 0)
  INTO v_total_paid, v_total_requested
  FROM payouts po
  WHERE po.organizer_id = v_org_id;

  -- Available balance = released funds - already paid - pending payouts
  v_available_balance := v_available_gross - v_total_paid - v_total_requested;
  IF v_available_balance < 0 THEN v_available_balance := 0; END IF;

  -- ── PER-EVENT BREAKDOWN (last 20 events) ──
  SELECT COALESCE(jsonb_agg(row_to_json(ev)::jsonb ORDER BY ev.event_date DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT
      e.id AS event_id,
      e.title AS event_title,
      e.date AS event_date,
      e.status AS event_status,
      COUNT(p.id) AS order_count,
      COALESCE(SUM(p.subtotal), 0)::numeric(12,2) AS gross_sales,
      COALESCE(SUM(p.tax_amount), 0)::numeric(12,2) AS tax,
      COALESCE(SUM(p.platform_fee_total), 0)::numeric(12,2) AS fees,
      COALESCE(SUM(p.organizer_net), 0)::numeric(12,2) AS net,
      CASE WHEN e.date > v_escrow_cutoff THEN 'pending' ELSE 'available' END AS balance_status,
      CASE WHEN e.date > v_escrow_cutoff
        THEN to_char(e.date + interval '3 days', 'Mon DD, YYYY')
        ELSE NULL
      END AS release_date
    FROM events e
    LEFT JOIN payments p ON p.event_id = e.id
      AND p.organizer_id = v_org_id
      AND p.status = 'paid'
    WHERE e.organizer_id = v_user_id
    GROUP BY e.id, e.title, e.date, e.status
    HAVING COUNT(p.id) > 0
    LIMIT 20
  ) ev;

  -- ── RECENT PAYOUTS (last 10) ──
  SELECT COALESCE(jsonb_agg(row_to_json(po)::jsonb ORDER BY po.requested_at DESC), '[]'::jsonb)
  INTO v_recent_payouts
  FROM (
    SELECT
      po.id,
      po.net_amount,
      po.currency,
      po.status,
      po.payout_method,
      po.requested_at,
      po.processed_at,
      po.failure_reason,
      po.external_ref,
      e.title AS event_title
    FROM payouts po
    LEFT JOIN events e ON e.id = po.event_id
    WHERE po.organizer_id = v_org_id
    ORDER BY po.requested_at DESC NULLS LAST
    LIMIT 10
  ) po;

  -- ── RETURN ──
  RETURN jsonb_build_object(
    'has_organizer', true,
    'organizer_id', v_org_id,
    'currency', v_currency,

    -- Summary totals
    'gross_sales', v_gross_sales,
    'tax_collected', v_tax_collected,
    'platform_fees', v_platform_fees,
    'promo_discounts', v_promo_discounts,
    'net_revenue', v_net_revenue,
    'refunded_amount', v_refunded_amount,

    -- Balance breakdown
    'pending_balance', v_pending_balance,
    'available_balance', v_available_balance,
    'total_paid', v_total_paid,
    'total_requested', v_total_requested,

    -- Escrow info
    'escrow_days', 3,
    'escrow_cutoff', v_escrow_cutoff,

    -- Detailed data
    'events', v_events,
    'recent_payouts', v_recent_payouts
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════ STEP 2: Grant access ════════════
GRANT EXECUTE ON FUNCTION get_organizer_financials() TO authenticated;


-- ════════════ ✅ MIGRATION v26 TASK 1 COMPLETE ════════════
--
-- RPC created:
--   ✓ get_organizer_financials() → JSONB
--
-- Returns:
--   ✓ gross_sales, tax_collected, platform_fees, net_revenue
--   ✓ pending_balance (escrow: events < 3 days old)
--   ✓ available_balance (released - paid - requested)
--   ✓ events[] breakdown with per-event financials
--   ✓ recent_payouts[] history
--
-- Test:
--   SELECT get_organizer_financials();
