-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v32: BRD Financial Hardening
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Replaces functions only. No data loss.
--
-- Fixes applied:
--   1. BRD Rule 1: Reservation expiry 35min → 10min (auth + guest)
--   2. BRD Rule 5: Escrow uses COALESCE(end_date, date) not just date
--   3. Audit Fix:  get_organizer_revenue reads from payments table
--                  instead of hardcoded 5% commission
-- ═══════════════════════════════════════════════════════════════


-- ════════════ FIX 1: Reservation Duration → 10 Minutes ════════════
-- BRD Rule 1: "التذاكر يجب أن تُقفل لمدة 10 دقائق فقط"
-- Was: 35 minutes — far too long, blocks tickets unnecessarily.

-- Fix 1a: Authenticated reservation
CREATE OR REPLACE FUNCTION create_reservation(p_user_id UUID, p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE(reservation_id UUID, expires_at TIMESTAMPTZ, tier_name TEXT, tier_price DECIMAL, event_title TEXT, event_id UUID) AS $$
DECLARE v_tier RECORD; v_reservation_id UUID; v_expires TIMESTAMPTZ;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN RAISE EXCEPTION 'Quantity must be between 1 and 10'; END IF;
  SELECT tt.id, tt.name, tt.price, tt.capacity, tt.event_id, e.title AS event_title,
    tt.capacity - COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.ticket_tier_id = tt.id AND r.status = 'active'), 0)
    - COALESCE((SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned')), 0) AS available
  INTO v_tier FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id WHERE tt.id = p_tier_id FOR UPDATE OF tt;
  IF v_tier IS NULL THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;
  IF v_tier.available < p_quantity THEN RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_tier.available; END IF;
  v_expires := NOW() + INTERVAL '10 minutes';  -- BRD Rule 1: 10-minute cart lock
  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active') RETURNING id INTO v_reservation_id;
  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- Fix 1b: Guest reservation
DROP FUNCTION IF EXISTS create_guest_reservation(UUID, INT);

CREATE OR REPLACE FUNCTION create_guest_reservation(p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS JSONB AS $func$
DECLARE
  v_name TEXT; v_price DECIMAL; v_eid UUID; v_etitle TEXT; v_oid UUID;
  v_cap INT; v_reserved BIGINT; v_sold BIGINT; v_available INT;
  v_expires TIMESTAMPTZ; v_rid UUID;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  EXECUTE 'SELECT tt.name, tt.price, tt.event_id, e.title, e.organizer_id, tt.capacity
    FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id
    WHERE tt.id = $1 FOR UPDATE OF tt'
  INTO v_name, v_price, v_eid, v_etitle, v_oid, v_cap
  USING p_tier_id;

  IF v_name IS NULL THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;

  EXECUTE 'SELECT COALESCE(SUM(quantity), 0) FROM reservations
    WHERE ticket_tier_id = $1 AND status = ''active'''
  INTO v_reserved USING p_tier_id;

  EXECUTE 'SELECT COUNT(*) FROM tickets
    WHERE ticket_tier_id = $1 AND status IN (''valid'',''scanned'')'
  INTO v_sold USING p_tier_id;

  v_available := v_cap - v_reserved - v_sold;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  v_expires := NOW() + INTERVAL '10 minutes';  -- BRD Rule 1: 10-minute cart lock

  EXECUTE 'INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
    VALUES (NULL, $1, $2, $3, ''active'') RETURNING id'
  INTO v_rid USING p_tier_id, p_quantity, v_expires;

  RETURN jsonb_build_object(
    'reservation_id', v_rid, 'expires_at', v_expires,
    'tier_name', v_name, 'tier_price', v_price,
    'event_title', v_etitle, 'event_id', v_eid, 'organizer_id', v_oid
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ FIX 2: Escrow Uses end_date Instead of date ════════════
-- BRD Rule 5: "الأموال لا تتاح إلا بعد انتهاء الحدث بنجاح"
-- Was: e.date (event START) — funds released before event finishes
-- Fix: COALESCE(e.end_date, e.date) — uses actual end date

-- Fix 2a: get_organizer_financials
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

  -- Escrow cutoff: 3 days after event ENDS
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
  -- BRD FIX: Use COALESCE(e.end_date, e.date) — event END date, not start
  -- Pending = organizer_net from events that END AFTER the escrow cutoff
  SELECT COALESCE(SUM(p.organizer_net), 0)
  INTO v_pending_balance
  FROM payments p
  JOIN events e ON e.id = p.event_id
  WHERE p.organizer_id = v_org_id
    AND p.status = 'paid'
    AND COALESCE(e.end_date, e.date) > v_escrow_cutoff;  -- ← FIXED: was e.date

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
      CASE WHEN COALESCE(e.end_date, e.date) > v_escrow_cutoff THEN 'pending' ELSE 'available' END AS balance_status,  -- ← FIXED
      CASE WHEN COALESCE(e.end_date, e.date) > v_escrow_cutoff  -- ← FIXED
        THEN to_char(COALESCE(e.end_date, e.date) + interval '3 days', 'Mon DD, YYYY')
        ELSE NULL
      END AS release_date
    FROM events e
    LEFT JOIN payments p ON p.event_id = e.id
      AND p.organizer_id = v_org_id
      AND p.status = 'paid'
    WHERE e.organizer_id = v_user_id
    GROUP BY e.id, e.title, e.date, e.end_date, e.status
    HAVING COUNT(p.id) > 0
    LIMIT 20
  ) ev;

  -- ── RECENT PAYOUTS (last 10) ──
  SELECT COALESCE(jsonb_agg(row_to_json(po)::jsonb ORDER BY po.requested_at DESC), '[]'::jsonb)
  INTO v_recent_payouts
  FROM (
    SELECT
      po.id,
      po.gross_amount,
      po.platform_fees,
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


-- Fix 2b: request_payout — same escrow date fix
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

  -- BRD FIX: Use COALESCE(e.end_date, e.date) for escrow calculation
  -- Pending balance (escrow: events that haven't ended + 3 days)
  SELECT COALESCE(SUM(p.organizer_net), 0)
  INTO v_pending_balance
  FROM payments p
  JOIN events e ON e.id = p.event_id
  WHERE p.organizer_id = v_org_id
    AND p.status = 'paid'
    AND COALESCE(e.end_date, e.date) > v_escrow_cutoff;  -- ← FIXED: was e.date

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
    p_amount,
    0,
    0,
    p_amount,
    v_currency,
    v_payout_method,
    v_payout_dest,
    'pending',
    now()
  )
  RETURNING id INTO v_payout_id;

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


-- ════════════ FIX 3: get_organizer_revenue — Use payments Table ════════════
-- Was: Hardcoded 5% commission calculation from ticket prices
-- Fix: Read actual financial data from payments table

CREATE OR REPLACE FUNCTION get_organizer_revenue(p_organizer_id UUID)
RETURNS TABLE(
  event_id UUID, event_title TEXT, event_date TIMESTAMPTZ, event_status TEXT,
  total_tickets_sold BIGINT, total_capacity BIGINT, gross_revenue NUMERIC,
  platform_fee NUMERIC, net_revenue NUMERIC, scanned_count BIGINT, scan_rate NUMERIC
) AS $func$
DECLARE
  v_caller_id UUID;
BEGIN
  -- SECURITY: Always use the authenticated caller's ID, never the parameter
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  WITH ticket_stats AS (
    SELECT
      tt.event_id AS ev_id,
      COUNT(*) FILTER (WHERE t.status IN ('valid','scanned')) AS sold,
      COUNT(*) FILTER (WHERE t.status = 'scanned') AS scanned
    FROM tickets t
    JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
    GROUP BY tt.event_id
  ),
  capacity_stats AS (
    SELECT ct.event_id AS ev_id, SUM(ct.capacity)::BIGINT AS total_cap
    FROM ticket_tiers ct GROUP BY ct.event_id
  ),
  -- FIX: Read actual financial data from payments table instead of hardcoded 5%
  payment_stats AS (
    SELECT
      p.event_id AS ev_id,
      COALESCE(SUM(p.subtotal), 0) AS gross,
      COALESCE(SUM(p.platform_fee_total), 0) AS fees,
      COALESCE(SUM(p.organizer_net), 0) AS net
    FROM payments p
    WHERE p.status = 'paid'
    GROUP BY p.event_id
  )
  SELECT
    e.id, e.title::TEXT, e.date, e.status::TEXT,
    COALESCE(ts.sold, 0)::BIGINT,
    COALESCE(cs.total_cap, 0)::BIGINT,
    COALESCE(ps.gross, 0),       -- ← was: hardcoded ticket_price * count
    COALESCE(ps.fees, 0),        -- ← was: gross * 0.05
    COALESCE(ps.net, 0),         -- ← was: gross * 0.95
    COALESCE(ts.scanned, 0)::BIGINT,
    CASE WHEN COALESCE(ts.sold, 0) > 0
      THEN ROUND(COALESCE(ts.scanned, 0)::NUMERIC / GREATEST(ts.sold, 1) * 100, 1)
      ELSE 0 END
  FROM events e
  LEFT JOIN ticket_stats ts ON ts.ev_id = e.id
  LEFT JOIN capacity_stats cs ON cs.ev_id = e.id
  LEFT JOIN payment_stats ps ON ps.ev_id = e.id
  WHERE e.organizer_id = v_caller_id
  ORDER BY e.date DESC;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ Grants (idempotent) ════════════
GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_guest_reservation(UUID, INT) TO anon;
GRANT EXECUTE ON FUNCTION get_organizer_financials() TO authenticated;
GRANT EXECUTE ON FUNCTION request_payout(DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION get_organizer_revenue(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_organizer_revenue(UUID) FROM anon;


-- ════════════ ✅ MIGRATION v32 COMPLETE ════════════
--
-- Fixes applied:
--   ✓ FIX 1: Reservation expiry 35min → 10min (auth + guest)
--   ✓ FIX 2: Escrow uses COALESCE(end_date, date) instead of just date
--   ✓ FIX 3: get_organizer_revenue reads from payments table (not hardcoded 5%)
--
-- External fixes (not in this SQL):
--   ✓ create-checkout Edge Function: Stripe Connect gate + session 630s
--   ✓ stripe-webhook Edge Function: payments.status updated on refund
--   ✓ wizard-publishing.js: Stripe Connect check before publish
--
-- Verification:
--
--   -- Test reservation expiry (should be ~10 min from now):
--   SELECT create_reservation('<user_id>', '<tier_id>', 1);
--
--   -- Check escrow uses end_date:
--   SELECT get_organizer_financials();
--
--   -- Verify revenue reads from payments table:
--   SELECT * FROM get_organizer_revenue('<organizer_id>');
