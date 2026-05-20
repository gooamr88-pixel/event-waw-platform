-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — EMERGENCY FIX: Missing columns required by fulfill_checkout
--
-- ROOT CAUSE: The fulfill_checkout RPC (migration-v37) inserts into
-- columns that may not exist yet because prerequisite migrations
-- (v5, v19-task3) were never applied, or were applied to a different
-- database instance.
--
-- This migration is FULLY IDEMPOTENT — safe to run multiple times.
-- It ensures every column referenced by fulfill_checkout exists.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ 1. ORDERS TABLE: Add all missing columns ════════════

-- Guest checkout support (originally from migration-v5)
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT;

-- Financial snapshot columns (originally from migration-v19-task3)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate_snapshot DECIMAL(5,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;

-- PDF status tracking (from migration-v37 step 1)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pdf_status TEXT DEFAULT 'pending';


-- ════════════ 2. PAYMENTS TABLE: Add missing tax_inclusive ════════════
-- fulfill_checkout inserts into payments.tax_inclusive but it was never
-- added to the payments table definition in migration-v19-task1.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;


-- ════════════ 3. WEBHOOK_FAILURES: Add resolved tracking ════════════
-- (from migration-v37 step 2)

ALTER TABLE webhook_failures ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT false;
ALTER TABLE webhook_failures ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE webhook_failures ADD COLUMN IF NOT EXISTS resolution TEXT;


-- ════════════ 4. Ensure get_order_by_session RPC exists ════════════
-- This is what the checkout-success page polls via tickets.js

CREATE OR REPLACE FUNCTION get_order_by_session(p_session_id TEXT)
RETURNS JSONB AS $func$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', o.id,
    'amount', o.amount,
    'status', o.status,
    'currency', o.currency,
    'is_guest', o.is_guest,
    'guest_name', o.guest_name,
    'guest_email', o.guest_email,
    'created_at', o.created_at,
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'qr_hash', t.qr_hash,
        'status', t.status,
        'tier_name', tt.name,
        'tier_price', tt.price,
        'event_title', ev.title,
        'event_venue', ev.venue,
        'event_date', ev.date,
        'event_cover', ev.cover_image
      ) ORDER BY t.created_at)
      FROM tickets t
      JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
      JOIN events ev ON ev.id = tt.event_id
      WHERE t.order_id = o.id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM orders o
  WHERE o.stripe_session_id = p_session_id;

  RETURN v_result;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO anon;


-- ════════════ ✅ VERIFICATION ════════════
-- After running, verify with:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders'
--   AND column_name IN ('is_guest','guest_name','guest_email','subtotal',
--                        'tax_amount','platform_fee_amount','pdf_status');
--   -- Expected: 7 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'payments' AND column_name = 'tax_inclusive';
--   -- Expected: 1 row
--
--   SELECT proname FROM pg_proc WHERE proname = 'fulfill_checkout';
--   -- Expected: 1 row (from migration-v37)
