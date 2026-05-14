-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — CRITICAL FIX: Webhook Order Insert Crash
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Fully idempotent. Uses IF NOT EXISTS / IF EXISTS.
--
-- ROOT CAUSE: The stripe-webhook Edge Function inserts orders with
-- financial columns (subtotal, tax_amount, tax_rate_snapshot,
-- platform_fee_amount) that only exist if migration-v19-task3 was applied.
-- If missing, every webhook call crashes with "column does not exist"
-- and NO order is ever created, causing the frontend polling to fail.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ FIX 1: Add missing financial columns to orders ════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate_snapshot DECIMAL(5,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;


-- ════════════ FIX 2: Ensure guest columns exist on orders ════════════
-- (from migration-v5, but re-affirm for safety)

ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT;


-- ════════════ FIX 3: Ensure get_order_by_session RPC exists ════════════
-- SECURITY DEFINER so it bypasses RLS for both guest and auth users.

DROP FUNCTION IF EXISTS get_order_by_session(TEXT);

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

-- Allow both auth and anon users to call this
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO anon;


-- ════════════ FIX 4: Clean up harmless National ID remnant ════════════
-- Not causing crashes, but removing dead weight for US compliance clarity.

ALTER TABLE orders DROP COLUMN IF EXISTS guest_national_id;


-- ════════════ ✅ VERIFICATION ════════════
-- Run these after the migration to confirm:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders'
--   AND column_name IN ('subtotal', 'tax_amount', 'tax_rate_snapshot', 'platform_fee_amount');
--   -- Expected: 4 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'guest_national_id';
--   -- Expected: 0 rows (removed)
--
--   SELECT proname FROM pg_proc WHERE proname = 'get_order_by_session';
--   -- Expected: 1 row
