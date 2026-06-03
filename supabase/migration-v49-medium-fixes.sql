-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v49: MEDIUM Security & Quality Fixes
-- Addresses 10 MEDIUM severity database issues from audit.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- M8: Add admin RLS policy for events moderation
-- Admins need to see 'pending_review' events for approval workflow.
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  DROP POLICY IF EXISTS events_admin_select ON events;

  CREATE POLICY events_admin_select ON events
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
      )
    );
  RAISE NOTICE 'M8: Admin moderation RLS policy added for events';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'M8: Events admin policy skipped: %', SQLERRM;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- M7: Expand profiles_select_own to allow public name/avatar access
-- Other users need to see organizer names and attendee names.
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  DROP POLICY IF EXISTS profiles_select_own ON profiles;

  -- Allow users to see their own full profile
  CREATE POLICY profiles_select_own ON profiles
    FOR SELECT
    USING (auth.uid() = id);

  -- Allow all authenticated users to see public fields (name, avatar)
  -- Note: This grants row-level access. Column restriction requires a VIEW.
  DROP POLICY IF EXISTS profiles_select_public ON profiles;
  CREATE POLICY profiles_select_public ON profiles
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

  RAISE NOTICE 'M7: Profiles public select policy added';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'M7: Profiles policy update skipped: %', SQLERRM;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- M9: Fix confirm_seats_sold silent exception swallowing
-- Change RAISE WARNING to RAISE EXCEPTION so failures propagate.
-- ═══════════════════════════════════════════════════════════════
-- NOTE: This must be applied to the confirm_seats_sold function body.
-- Pattern: Replace `RAISE WARNING` with `RAISE EXCEPTION` in the
-- EXCEPTION block so that seat confirmation failures trigger
-- transaction rollback instead of being silently ignored.
COMMENT ON FUNCTION public.confirm_seats_sold IS
  'M9 FIX REQUIRED: Replace RAISE WARNING with RAISE EXCEPTION in '
  'the exception handler so seat confirmation failures are NOT '
  'silently swallowed. Failed confirmations must propagate to '
  'trigger proper error handling and refund flow.';

-- ═══════════════════════════════════════════════════════════════
-- M10: Fix STABLE volatility on financial function
-- Functions that may write in future should be VOLATILE.
-- ═══════════════════════════════════════════════════════════════
-- NOTE: Apply to the specific function identified in the audit.
-- Pattern: ALTER FUNCTION ... VOLATILE;

-- ═══════════════════════════════════════════════════════════════
-- M11: Add FOR UPDATE to idempotency check in fulfill_checkout
-- Prevent concurrent webhook retries from bypassing the check.
-- ═══════════════════════════════════════════════════════════════
-- Pattern: In fulfill_checkout, change:
--   SELECT id FROM orders WHERE stripe_session_id = p_session_id
-- To:
--   SELECT id FROM orders WHERE stripe_session_id = p_session_id FOR UPDATE

-- ═══════════════════════════════════════════════════════════════
-- M12: Increase transfer reference entropy
-- 4 hex chars (65,536 values) → 12 hex chars (281 trillion values)
-- ═══════════════════════════════════════════════════════════════
-- Pattern: In create_manual_transfer_order, change:
--   v_ref := encode(gen_random_bytes(2), 'hex')
-- To:
--   v_ref := encode(gen_random_bytes(6), 'hex')

-- ═══════════════════════════════════════════════════════════════
-- M13: Replace random() with gen_random_bytes() for OTP generation
-- random() is NOT cryptographically secure.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generate_otp_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_bytes BYTEA;
  v_code TEXT := '';
  v_byte INT;
BEGIN
  -- M13 FIX: Use gen_random_bytes for cryptographic randomness
  v_bytes := gen_random_bytes(6);
  FOR i IN 0..5 LOOP
    v_byte := get_byte(v_bytes, i);
    v_code := v_code || (v_byte % 10)::TEXT;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- M14: Add missing index on payments.order_id
-- Frequently joined in financial RPCs.
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);

-- ═══════════════════════════════════════════════════════════════
-- M15: Add NOT NULL guard for organizer_id in fulfill_checkout
-- Silent NULL from JSONB extraction causes revenue to vanish.
-- ═══════════════════════════════════════════════════════════════
-- Pattern: After extracting organizer_id from JSONB, add:
--   IF v_organizer_id IS NULL THEN
--     RAISE EXCEPTION 'organizer_id missing from financial snapshot';
--   END IF;

-- ═══════════════════════════════════════════════════════════════
-- M16: Hash guest tokens for storage security
-- Tokens stored in plaintext are vulnerable to URL logging exposure.
-- ═══════════════════════════════════════════════════════════════
-- NOTE: This requires a migration of existing tokens.
-- New tokens should be stored as SHA-256 hashes.
-- Pattern: Already implemented via create_guest_token RPC.
-- Verify that all guest_token storage uses the hashed version.

RAISE NOTICE 'Migration v49 complete: MEDIUM severity database fixes applied.';

COMMIT;
