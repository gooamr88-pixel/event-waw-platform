-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v54: Fix Guest Checkout Polling
-- Date: 2026-06-02
--
-- ═══════════════════════════════════════════════════════════════
-- PROBLEM:
--   After a successful guest Stripe checkout, the frontend polls
--   get_order_by_session() via RPC but it ALWAYS returns NULL,
--   causing the success page to show a timeout error.
--   The webhook creates the order correctly (confirmed in logs).
--
-- ROOT CAUSE:
--   Migration v51 (V-03 fix) introduced "guest-to-user email linking":
--   When a guest checks out with an email that matches an existing
--   user profile, fulfill_checkout() sets order.user_id to that
--   user's UUID (so tickets appear on their "My Tickets" page).
--
--   HOWEVER, this BREAKS the v47 authorization check in
--   get_order_by_session():
--
--     IF v_order.user_id IS NOT NULL THEN
--       IF auth.uid() IS NULL OR auth.uid() != v_order.user_id THEN
--         RETURN NULL;  ← BLOCKED: guest has no auth session!
--       END IF;
--     END IF;
--
--   The guest caller has auth.uid() = NULL (anon), but the order now
--   has user_id = <real_user_uuid> due to V-03 linking. So the check
--   fails and returns NULL even though the order is a guest order.
--
-- FIX:
--   Check BOTH user_id AND is_guest flag. If is_guest = true, allow
--   access via session_id regardless of whether user_id was linked.
--   The Stripe session_id is a 66+ char high-entropy bearer token
--   known only to the paying user (from the redirect URL).
--
-- SECURITY:
--   - Guest orders: session_id acts as bearer token (unchanged)
--   - Authenticated orders: auth.uid() must match user_id (unchanged)
--   - Linked guest orders: is_guest=true allows session_id access
--     even when user_id is set (this is the fix)
--   - No other user's data is ever exposed
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

BEGIN;


-- ════════════ Drop existing version cleanly ════════════
DROP FUNCTION IF EXISTS get_order_by_session(TEXT);


-- ════════════ Recreate with fixed authorization logic ════════════
CREATE OR REPLACE FUNCTION get_order_by_session(p_session_id TEXT)
RETURNS JSONB AS $func$
DECLARE
  v_result JSONB;
  v_order  RECORD;
BEGIN
  -- ── Input validation ──
  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN NULL;
  END IF;

  -- ── Fetch order (SECURITY DEFINER bypasses RLS) ──
  SELECT o.id, o.user_id, o.is_guest, o.amount, o.status,
         o.currency, o.guest_name, o.guest_email, o.created_at
  INTO v_order
  FROM orders o
  WHERE o.stripe_session_id = p_session_id;

  -- No order found (webhook hasn't arrived yet, or invalid session_id)
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- AUTHORIZATION CHECK (v54 — fixes v47 C6 + v51 V-03 collision)
  -- ══════════════════════════════════════════════════════════════
  --
  -- Case 1: GUEST order (is_guest = true)
  --   → Allow access regardless of user_id.
  --   → V-03 may have linked user_id to an existing account, but
  --     the order is still a guest checkout. The Stripe session_id
  --     serves as the bearer token (66+ chars, high entropy).
  --   → The guest caller has no auth session (auth.uid() IS NULL),
  --     so we MUST NOT require auth.uid() = user_id here.
  --
  -- Case 2: AUTHENTICATED order (is_guest = false, user_id IS NOT NULL)
  --   → Caller must own the order: auth.uid() = user_id
  --   → If caller is anonymous or a different user → return NULL
  --
  -- Case 3: No user_id, not guest (shouldn't happen, but safe fallback)
  --   → Allow access via session_id (same as guest logic)
  --
  IF v_order.is_guest = false AND v_order.user_id IS NOT NULL THEN
    -- Authenticated (non-guest) order: caller must be the owner
    IF auth.uid() IS NULL OR auth.uid() != v_order.user_id THEN
      RETURN NULL;  -- Same response as "not found" to prevent info leak
    END IF;
  END IF;
  -- Guest orders (is_guest = true): session_id knowledge = authorization ✓
  -- Even if user_id was set by V-03 linking, this is still a guest checkout.

  -- ── Build the full result with ticket details ──
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
  WHERE o.id = v_order.id;

  RETURN v_result;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';


-- ════════════ Grant execution to both roles ════════════
-- anon: needed for guest checkout success page (no auth session)
-- authenticated: needed for logged-in user checkout success page
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO authenticated;


COMMIT;


-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRATION v54 COMPLETE
-- ═══════════════════════════════════════════════════════════════
--
-- VERIFICATION — Run these queries after applying:
--
--   -- 1. Function exists with SECURITY DEFINER + search_path?
--   SELECT proname, prosecdef, proconfig
--   FROM pg_proc WHERE proname = 'get_order_by_session';
--   -- Expected: prosecdef = true, proconfig = {search_path=public}
--
--   -- 2. Both anon and authenticated have EXECUTE?
--   SELECT grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE routine_name = 'get_order_by_session';
--   -- Expected: 'anon' with 'EXECUTE' and 'authenticated' with 'EXECUTE'
--
--   -- 3. Test with the failing session_id (it should now return data):
--   SELECT get_order_by_session('cs_test_a1Qv2eMq3XAHlhkm64F1KBHj4PeLgpQo0h20ruWaVJcrIgz2mr6g4J7anr');
--   -- Expected: JSONB with order data and nested tickets array
--
--   -- 4. Verify the order HAS is_guest=true AND user_id IS NOT NULL:
--   SELECT id, is_guest, user_id, guest_email
--   FROM orders
--   WHERE stripe_session_id = 'cs_test_a1Qv2eMq3XAHlhkm64F1KBHj4PeLgpQo0h20ruWaVJcrIgz2mr6g4J7anr';
--   -- Expected: is_guest=true, user_id=<some UUID> (linked by V-03)
--
--   -- 5. Confirm the auth check still blocks unauthorized access:
--   -- (Run from an anon session or as a different user)
--   -- Create a NON-guest order and try to access it without auth:
--   --   SELECT get_order_by_session('cs_live_SOME_AUTH_ORDER');
--   --   Expected: NULL (blocked because is_guest=false requires auth.uid()=user_id)
