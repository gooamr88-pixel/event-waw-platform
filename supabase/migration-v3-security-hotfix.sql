-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Security Hotfix Migration v3
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Does NOT drop tables or data.
-- It only tightens permissions, fixes policies, and adds
-- recovery infrastructure.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ 1. Fix Profile INSERT Policy ════════════
-- Problem: WITH CHECK (true) lets anyone insert a profile for ANY user ID
-- Fix: Only allow inserting a profile where id = your own auth.uid()

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);


-- ════════════ 2. Revoke Dangerous GRANT ALL ════════════
-- Problem: GRANT ALL ON ALL TABLES lets authenticated users bypass
-- all business logic (create fake tickets, change roles, modify orders)

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM authenticated;


-- ════════════ 3. Apply Granular Table Permissions ════════════
-- Only grant the minimum permissions needed per table.
-- RLS policies still filter rows within these grants.

-- profiles: users can read/create/update their own profile
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;

-- events: organizers create/update/delete, everyone reads (filtered by RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO authenticated;

-- ticket_tiers: organizers manage, everyone reads (filtered by RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_tiers TO authenticated;

-- reservations: read-only for users (created via SECURITY DEFINER RPC only)
GRANT SELECT ON reservations TO authenticated;

-- orders: read-only for users (created by webhook via service_role only)
GRANT SELECT ON orders TO authenticated;

-- tickets: read-only for users (created by webhook via service_role only)
GRANT SELECT ON tickets TO authenticated;

-- login_otps: users can read and update their own OTPs (RLS enforced)
GRANT SELECT, UPDATE ON login_otps TO authenticated;

-- Sequences needed for auto-generated IDs on allowed inserts
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ════════════ 4. Re-grant Specific RPC Functions ════════════
-- After revoking ALL ROUTINES, re-grant only the functions
-- that authenticated users legitimately need to call.

GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tier_availability(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_login_otp(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_organizer_revenue(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_tier_revenue(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_revenue(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_updated_at() TO authenticated;


-- ════════════ 5. Keep Anonymous Read Access ════════════
-- Anonymous users need to browse published events on the landing page

GRANT SELECT ON events TO anon;
GRANT SELECT ON ticket_tiers TO anon;


-- ════════════ 6. Sold Count Reconciliation Function ════════════
-- sold_count is a denormalized cache that can drift.
-- This function reconciles it against actual ticket counts.

CREATE OR REPLACE FUNCTION reconcile_sold_counts() RETURNS void AS $$
BEGIN
  UPDATE ticket_tiers tt SET sold_count = COALESCE((
    SELECT COUNT(*) FROM tickets t
    WHERE t.ticket_tier_id = tt.id
    AND t.status IN ('valid', 'scanned')
  ), 0);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke from public, only service_role / cron should call this
REVOKE EXECUTE ON FUNCTION reconcile_sold_counts() FROM authenticated, anon;


-- ════════════ 7. Webhook Failures Recovery Table ════════════
-- If ticket creation fails after order is created, log it here
-- for manual recovery. Only service_role can access (no RLS policies).

CREATE TABLE IF NOT EXISTS webhook_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT,
  order_id UUID,
  error TEXT,
  payload JSONB,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE webhook_failures ENABLE ROW LEVEL SECURITY;
-- No policies = only service_role can read/write


-- ════════════ 8. Schedule Daily Reconciliation ════════════

DO $$ BEGIN
  PERFORM cron.schedule('reconcile-sold', '0 3 * * *',
    $c$ SELECT reconcile_sold_counts(); $c$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available — skip reconcile schedule';
END $$;


-- ════════════ ✅ DONE ════════════
-- Verification queries:
--
--   -- Check authenticated grants (should show granular, NOT "ALL"):
--   SELECT grantee, privilege_type, table_name
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'authenticated'
--   ORDER BY table_name, privilege_type;
--
--   -- Check profile insert policy:
--   SELECT polname, polcmd, polqual
--   FROM pg_policies
--   WHERE tablename = 'profiles' AND polname = 'profiles_insert';
--
--   -- Check webhook_failures exists:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'webhook_failures';
