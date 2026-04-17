-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Security Migration v2
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: This does NOT drop any tables or data.
-- It only adds a column, revokes dangerous permissions,
-- and tightens one RLS policy.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ 1. Add national_id column to profiles ════════════
-- (Will be used to store the Egyptian national ID collected at checkout)

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS national_id TEXT;


-- ════════════ 2. REVOKE sensitive RPCs from authenticated users ════════════
-- Problem: Any logged-in user can call these functions directly via supabase.rpc()
-- Fix: Only Edge Functions (service_role) should call them

-- OTP functions return the raw OTP code — must be service_role only
REVOKE EXECUTE ON FUNCTION generate_login_otp() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION generate_login_otp_for_user(UUID) FROM authenticated, anon;

-- Revenue functions — keep for authenticated (organizers need them), block anon
REVOKE EXECUTE ON FUNCTION get_organizer_revenue(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION get_event_tier_revenue(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION get_daily_revenue(UUID, INT) FROM anon;

-- These should only run from Edge Functions or pg_cron, never from client
REVOKE EXECUTE ON FUNCTION increment_sold_count(UUID, INT) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION expire_stale_reservations() FROM authenticated, anon;


-- ════════════ 3. Remove direct INSERT on reservations ════════════
-- Problem: Users can INSERT directly into reservations table,
--          bypassing the capacity check in create_reservation() RPC.
-- Fix: Drop the INSERT policy. Reservations are only created via
--       the SECURITY DEFINER function create_reservation().

DROP POLICY IF EXISTS "reservations_insert" ON reservations;


-- ════════════ ✅ DONE ════════════
-- Verification: Run these to confirm the changes worked:
--
--   SELECT column_name FROM information_schema.columns 
--   WHERE table_name = 'profiles' AND column_name = 'national_id';
--   → Should return 1 row
--
--   SELECT polname FROM pg_policies 
--   WHERE tablename = 'reservations' AND polname = 'reservations_insert';
--   → Should return 0 rows (policy deleted)
