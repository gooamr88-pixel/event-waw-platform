-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v50: TERMS COMPLIANCE CHECK & SEEDED ORG FIX
-- Date: 2026-05-31
--
-- Fixes:
--   1. Securely re-defines check_terms_compliance(UUID) to allow
--      service_role (Edge Functions) and admins to check compliance
--      for arbitrary organizers, while restricting normal users to
--      only checking themselves.
--   2. Inserts terms acceptance and profile records for the seeded
--      organizer 'abb004da-f2f3-45ef-86de-8a528b8ce280' so that ticket
--      purchases for the "Electronic Music Night" event are unblocked.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════
-- 1. SECURE CO-EXISTENCE: check_terms_compliance()
-- ════════════════════════════════════════════════════════════
-- Allows service_role and admins to check any organizer's terms compliance,
-- but restricts normal users to checking only themselves.
-- Bypasses the C8 security-checkout conflict.

CREATE OR REPLACE FUNCTION check_terms_compliance(p_user_id UUID)
RETURNS JSONB AS $func$
DECLARE
  v_current_version TEXT;
  v_has_acceptance BOOLEAN;
  v_auth_user_id UUID := auth.uid();
  v_auth_role TEXT := auth.role();
  v_target_user_id UUID;
BEGIN
  -- SECURITY HARDENING (C8 FIX):
  -- 1. If called by service_role (Edge Functions), check the requested p_user_id (the event organizer)
  -- 2. If called by an admin (is_admin()), check the requested p_user_id
  -- 3. Otherwise (regular client calls), they can ONLY check their own compliance status.
  IF v_auth_role = 'service_role' OR is_admin() THEN
    v_target_user_id := p_user_id;
  ELSE
    v_target_user_id := v_auth_user_id;
  END IF;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('compliant', false, 'reason', 'Not authenticated');
  END IF;

  SELECT version_code INTO v_current_version
  FROM platform_terms_versions
  WHERE is_current = true AND terms_type = 'platform'
  LIMIT 1;

  -- No terms configured = no gate
  IF v_current_version IS NULL THEN
    RETURN jsonb_build_object('compliant', true, 'reason', 'No terms configured');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM terms_acceptances
    WHERE user_id = v_target_user_id
      AND terms_version = v_current_version
      AND terms_type = 'platform'
  ) INTO v_has_acceptance;

  IF NOT v_has_acceptance THEN
    RETURN jsonb_build_object(
      'compliant', false,
      'reason', 'You must accept the current platform terms (version ' || v_current_version || ') before publishing.',
      'required_version', v_current_version
    );
  END IF;

  RETURN jsonb_build_object('compliant', true, 'accepted_version', v_current_version);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Re-apply grants
GRANT EXECUTE ON FUNCTION check_terms_compliance(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION check_terms_compliance(UUID) FROM anon;


-- ════════════════════════════════════════════════════════════
-- 2. AUTO-HEAL: SEEDED ORGANIZER PROFILE & TERMS ACCEPTANCE
-- ════════════════════════════════════════════════════════════
-- Auto-heals the seeded organizer 'abb004da-f2f3-45ef-86de-8a528b8ce280'
-- to unblock ticket purchases for "Electronic Music Night".

-- A. Ensure the profile exists
INSERT INTO profiles (id, email, full_name, role)
VALUES (
  'abb004da-f2f3-45ef-86de-8a528b8ce280',
  'organizer.electronic@eventsli.com',
  'Electronic Music Organizer',
  'organizer'
)
ON CONFLICT (id) DO UPDATE
SET role = 'organizer';

-- B. Ensure the organizer record exists with Stripe Connect onboarding active
INSERT INTO organizers (user_id, payout_method, stripe_onboarding_complete)
VALUES ('abb004da-f2f3-45ef-86de-8a528b8ce280', 'bank', true)
ON CONFLICT (user_id) DO UPDATE
SET stripe_onboarding_complete = true;

-- C. Insert terms acceptance for active platform terms version '2026-05-15-v1'
INSERT INTO terms_acceptances (user_id, organizer_id, terms_type, terms_version, terms_hash)
SELECT 'abb004da-f2f3-45ef-86de-8a528b8ce280', 
       id, 
       'platform', 
       '2026-05-15-v1', 
       'default_hash'
FROM organizers 
WHERE user_id = 'abb004da-f2f3-45ef-86de-8a528b8ce280'
  AND NOT EXISTS (
    SELECT 1 FROM terms_acceptances 
    WHERE user_id = 'abb004da-f2f3-45ef-86de-8a528b8ce280' 
      AND terms_type = 'platform' 
      AND terms_version = '2026-05-15-v1'
  );

-- D. Sync organizer profile cache
UPDATE organizers
SET terms_accepted_at = now(),
    terms_version = '2026-05-15-v1',
    terms_current_version = '2026-05-15-v1'
WHERE user_id = 'abb004da-f2f3-45ef-86de-8a528b8ce280';

COMMIT;
