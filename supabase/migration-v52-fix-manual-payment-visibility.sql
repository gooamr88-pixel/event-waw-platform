-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v52: Fix Manual Payment Visibility
-- Date: 2026-06-01
--
-- ROOT CAUSE:
--   The event-detail page reads organizer payment methods via:
--     supabase.from('organizers').select('manual_payment_methods')
--                                .eq('user_id', event.organizer_id)
--
--   But RLS on `organizers` only allows `user_id = auth.uid()`.
--   Buyers/attendees are NOT the organizer, so the query returns NULL,
--   hiding ALL manual payment methods from the checkout UI.
--
-- FIX:
--   Create a SECURITY DEFINER RPC that safely exposes only the
--   public payment configuration for a given event. This bypasses
--   RLS without exposing sensitive organizer data (bank accounts, etc.)
--
-- ⚠️ SAFE TO RUN: Adds new function + grants. No data loss.
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════
-- get_event_payment_config(p_event_id UUID)
--
-- Returns the payment configuration for a specific event's organizer.
-- Only returns PUBLIC-FACING data:
--   ✓ stripe_account_id (existence check — NOT the actual ID to callers)
--   ✓ stripe_onboarding_complete
--   ✓ manual_payment_methods (method names + destinations)
--   ✗ Does NOT expose: bank details, tax IDs, paypal emails, etc.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_event_payment_config(p_event_id UUID)
RETURNS JSONB AS $func$
DECLARE
  v_organizer_id UUID;
  v_has_stripe BOOLEAN;
  v_stripe_complete BOOLEAN;
  v_manual_methods JSONB;
BEGIN
  -- Step 1: Get the organizer user_id from the event
  SELECT organizer_id INTO v_organizer_id
  FROM events
  WHERE id = p_event_id;

  IF v_organizer_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Event not found',
      'has_stripe', false,
      'stripe_onboarding_complete', false,
      'manual_payment_methods', '[]'::JSONB
    );
  END IF;

  -- Step 2: Read organizer's payment config (bypasses RLS via SECURITY DEFINER)
  SELECT
    COALESCE(stripe_account_id, '') != '',
    COALESCE(stripe_onboarding_complete, false),
    COALESCE(manual_payment_methods, '[]'::JSONB)
  INTO v_has_stripe, v_stripe_complete, v_manual_methods
  FROM organizers
  WHERE user_id = v_organizer_id;

  -- If no organizer row exists yet, return defaults
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_stripe', false,
      'stripe_onboarding_complete', false,
      'manual_payment_methods', '[]'::JSONB
    );
  END IF;

  -- Step 3: Return only public-facing fields
  -- We explicitly do NOT return: stripe_account_id, bank details,
  -- paypal_email, tax_id, or any other sensitive data.
  RETURN jsonb_build_object(
    'has_stripe', v_has_stripe,
    'stripe_onboarding_complete', v_stripe_complete,
    'manual_payment_methods', v_manual_methods
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant to both authenticated users and anonymous (guest checkout)
GRANT EXECUTE ON FUNCTION get_event_payment_config(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_payment_config(UUID) TO anon;

COMMIT;


-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v52 COMPLETE
-- ════════════════════════════════════════════════════════════
--
-- Verification:
--   SELECT get_event_payment_config('<any-event-id>');
--   -- Should return: {"has_stripe": true/false, "manual_payment_methods": [...]}
--
-- Next: Update event-detail.html to call this RPC instead of
-- querying the organizers table directly.
