-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v39: CLEAN SLATE (Nuclear Fix)
--
-- PURPOSE: Fix EVERY schema mismatch that crashes fulfill_checkout.
-- This is a single, FULLY IDEMPOTENT script. Safe to run multiple times.
--
-- ROOT CAUSE: The fulfill_checkout RPC (migration-v37) inserts into
-- columns/enums that don't exist because prerequisite migrations
-- were not applied or were applied to a different DB instance.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ═══════════════════════════════════════════════════════════════


-- ════════════ FIX 1: ORDERS TABLE — Guest + Financial columns ════════════
-- fulfill_checkout sets user_id = NULL for guests, but base schema has NOT NULL.

DO $$ BEGIN
  ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Remove the FK constraint that references profiles(id), so guest orders
-- (user_id = NULL) don't violate referential integrity.
-- We re-add it as a nullable FK below.
DO $$ BEGIN
  ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Re-add as nullable FK (no NOT NULL)
DO $$ BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Guest checkout columns (from migration-v5)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT;

-- Financial snapshot columns (from migration-v19-task3)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate_snapshot DECIMAL(5,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;

-- PDF status tracking (from migration-v37 step 1)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pdf_status TEXT DEFAULT 'pending';


-- ════════════ FIX 2: PAYMENTS TABLE — Missing tax_inclusive ════════════
-- fulfill_checkout line 121 writes to payments.tax_inclusive, which was
-- never added to the payments table in migration-v19-phase1-task1.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;


-- ════════════ FIX 3: ORDER_STATUS ENUM — Add 'disputed' ════════════
-- stripe-webhook line 569 sets status = 'disputed' on charge.dispute.created,
-- but the enum only has: pending, paid, refunded, failed, canceled, partially_refunded.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'disputed';


-- ════════════ FIX 4: TICKET_TIERS — Currency column ════════════
-- create-checkout line 71 selects currency from ticket_tiers.
-- If missing, defaults to USD but that's wrong for non-USD events.

ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';


-- ════════════ FIX 5: WEBHOOK_FAILURES — Resolution tracking ════════════
-- migration-v37 step 2 adds these, but they may not exist.

ALTER TABLE webhook_failures ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT false;
ALTER TABLE webhook_failures ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE webhook_failures ADD COLUMN IF NOT EXISTS resolution TEXT;


-- ════════════ FIX 6: Ensure get_order_by_session RPC exists ════════════
-- This is what checkout-success.html polls via tickets.js.
-- SECURITY DEFINER bypasses RLS so both auth and guest users can poll.

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


-- ════════════ FIX 7: RLS policy for guest orders ════════════
-- Guest orders have user_id = NULL, so the existing RLS policy
-- "orders_select_own" (USING user_id = auth.uid()) blocks them.
-- The get_order_by_session RPC bypasses RLS (SECURITY DEFINER),
-- but direct table access needs a guest-friendly policy.

DO $$ BEGIN
  DROP POLICY IF EXISTS "orders_select_guest" ON orders;
  CREATE POLICY "orders_select_guest" ON orders FOR SELECT
    USING (is_guest = true AND guest_email IS NOT NULL);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ════════════ FIX 8: Ensure ticket-pdfs storage bucket exists ════════════
-- generate-ticket-pdf uploads to this bucket.

INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-pdfs', 'ticket-pdfs', false)
ON CONFLICT (id) DO NOTHING;


-- ════════════ ✅ VERIFICATION QUERIES ════════════
-- Run these AFTER the migration to confirm everything is fixed:
--
-- 1. Orders table has all required columns:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders'
--   AND column_name IN ('is_guest','guest_name','guest_email','guest_phone',
--                        'subtotal','tax_amount','tax_rate_snapshot',
--                        'platform_fee_amount','tax_inclusive','pdf_status');
--   -- Expected: 10 rows
--
-- 2. Payments table has tax_inclusive:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'payments' AND column_name = 'tax_inclusive';
--   -- Expected: 1 row
--
-- 3. order_status enum includes 'disputed':
--   SELECT unnest(enum_range(NULL::order_status));
--   -- Should include: disputed
--
-- 4. ticket_tiers has currency:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'ticket_tiers' AND column_name = 'currency';
--   -- Expected: 1 row
--
-- 5. fulfill_checkout function exists:
--   SELECT proname FROM pg_proc WHERE proname = 'fulfill_checkout';
--   -- Expected: 1 row
--
-- 6. get_order_by_session function exists:
--   SELECT proname FROM pg_proc WHERE proname = 'get_order_by_session';
--   -- Expected: 1 row
--
-- 7. orders.user_id is nullable:
--   SELECT is_nullable FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'user_id';
--   -- Expected: YES
--
-- 8. ticket-pdfs bucket exists:
--   SELECT id FROM storage.buckets WHERE id = 'ticket-pdfs';
--   -- Expected: 1 row
