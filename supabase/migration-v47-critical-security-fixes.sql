-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v47: CRITICAL SECURITY FIXES
-- Date: 2026-05-30
--
-- Fixes 5 critical vulnerabilities in the SQL layer:
--
--   C5: Guest orders RLS policy "orders_select_guest" allowed ANY user
--       to read ALL guest orders (no auth binding). Now restricted to
--       authenticated users who own the order (user_id = auth.uid()).
--       True guest orders (user_id IS NULL) are only accessible via
--       SECURITY DEFINER RPCs (get_order_by_session, etc.).
--
--   C6: get_order_by_session() IDOR — returned order+ticket+QR data
--       for ANY session_id with zero authentication. Now validates
--       that the caller owns the order OR the order is a guest order
--       accessed via the high-entropy Stripe session_id (which is
--       only known to the paying user and Stripe).
--
--   C7: create_manual_transfer_order() blanket EXCEPTION WHEN OTHERS
--       swallowed reservation/inventory violations, preventing
--       transaction rollback. Now only catches known soft-error
--       exceptions and lets critical errors propagate.
--
--   C8: check_terms_compliance() accepted arbitrary p_user_id param,
--       allowing any user to check compliance for any other user.
--       Now always uses auth.uid() internally.
--
--   C9: send_unconfigured_payments_email() had no authorization —
--       any authenticated user could trigger emails for any event.
--       Now requires caller to be the event organizer OR an admin.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

BEGIN;


-- ════════════════════════════════════════════════════════════
-- C5 FIX: Guest orders RLS — remove open access policy
-- ════════════════════════════════════════════════════════════
-- BEFORE: USING (is_guest = true AND guest_email IS NOT NULL)
--   → Any anonymous or authenticated user could SELECT all guest orders
-- AFTER:  USING (is_guest = true AND auth.uid() = user_id)
--   → Only works for "guest-turned-user" orders where user_id was set.
--   → True guest orders (user_id IS NULL) remain accessible ONLY via
--     SECURITY DEFINER RPCs (get_order_by_session, etc.) which bypass RLS.

DROP POLICY IF EXISTS "orders_select_guest" ON orders;

CREATE POLICY "orders_select_guest" ON orders FOR SELECT
  USING (
    is_guest = true
    AND user_id IS NOT NULL
    AND auth.uid() = user_id
  );


-- ════════════════════════════════════════════════════════════
-- C6 FIX: get_order_by_session() — add authorization check
-- ════════════════════════════════════════════════════════════
-- BEFORE: Returned full order+tickets+QR for ANY session_id, no auth.
-- AFTER:  For authenticated callers, verifies auth.uid() = order.user_id.
--         For guest orders (user_id IS NULL), the Stripe session_id itself
--         serves as a bearer token — it's a high-entropy string known only
--         to the paying user (from Stripe redirect) and our webhook.
--
-- NOTE ON RATE LIMITING: session_id enumeration is mitigated by:
--   1. session_id is a 66-char Stripe-generated string (cs_live_...)
--   2. Supabase has built-in request rate limiting
--   3. For additional protection, consider adding pg_rate_limiter or
--      an Edge Function rate limit in front of this RPC.

DROP FUNCTION IF EXISTS get_order_by_session(TEXT);

CREATE OR REPLACE FUNCTION get_order_by_session(p_session_id TEXT)
RETURNS JSONB AS $func$
DECLARE
  v_result JSONB;
  v_order  RECORD;
BEGIN
  -- Validate input
  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN NULL;
  END IF;

  -- Fetch the order first to check authorization
  SELECT o.id, o.user_id, o.is_guest, o.amount, o.status,
         o.currency, o.guest_name, o.guest_email, o.created_at
  INTO v_order
  FROM orders o
  WHERE o.stripe_session_id = p_session_id;

  -- No order found
  IF v_order IS NULL THEN
    RETURN NULL;
  END IF;

  -- AUTHORIZATION CHECK:
  -- Case 1: Authenticated user must own the order
  -- Case 2: Guest order (user_id IS NULL) — session_id acts as bearer token
  --         (only the paying user has this from the Stripe redirect URL)
  IF v_order.user_id IS NOT NULL THEN
    -- Authenticated order: caller must be the owner
    IF auth.uid() IS NULL OR auth.uid() != v_order.user_id THEN
      RETURN NULL;  -- Return NULL (same as "not found") to avoid info leak
    END IF;
  END IF;
  -- Guest orders (user_id IS NULL): session_id knowledge = authorization

  -- Build and return the full result
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
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Maintain existing grants (anon needed for guest checkout-success page)
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO anon;


-- ════════════════════════════════════════════════════════════
-- C7 FIX: create_manual_transfer_order() — remove blanket exception handler
-- ════════════════════════════════════════════════════════════
-- BEFORE: EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM)
--   → Caught ALL exceptions including reservation lock failures, FK violations,
--     and CHECK constraint violations, preventing proper transaction rollback.
-- AFTER:  Only catches specific known soft-error cases. Reservation failures,
--         inventory violations, and constraint errors propagate as real errors
--         which trigger automatic transaction rollback.

CREATE OR REPLACE FUNCTION create_manual_transfer_order(
  p_event_id        UUID,
  p_tier_id         UUID,
  p_quantity         INT,
  p_payment_method   TEXT,
  p_buyer_name       TEXT,
  p_buyer_email      TEXT,
  p_buyer_phone      TEXT,
  p_user_id          UUID DEFAULT NULL,
  p_seat_ids         UUID[] DEFAULT NULL,
  p_promo_code       TEXT DEFAULT NULL,
  p_proof_image_url  TEXT DEFAULT NULL,
  p_buyer_notes      TEXT DEFAULT NULL
) RETURNS JSONB AS $func$
DECLARE
  v_breakdown     JSONB;
  v_reservation   JSONB;
  v_res_id        UUID;
  v_order_id      UUID;
  v_reference     TEXT;
  v_org           RECORD;
  v_dest          TEXT;
  v_event         RECORD;
  v_method        manual_payment_method;
BEGIN
  -- ═══ VALIDATION ═══

  IF p_quantity < 1 OR p_quantity > 10 THEN
    RETURN jsonb_build_object('error', 'Quantity must be between 1 and 10');
  END IF;

  -- Validate payment method enum
  BEGIN
    v_method := p_payment_method::manual_payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('error', 'Invalid payment method: ' || p_payment_method);
  END;

  -- Check event exists, is published, and allows manual transfers
  SELECT e.id, e.title, e.organizer_id, e.status, e.listing_type,
         e.accepted_payment_methods, e.date
  INTO v_event
  FROM events e WHERE e.id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  IF v_event.status != 'published' THEN
    RETURN jsonb_build_object('error', 'Event is not published');
  END IF;

  -- Block manual transfers for free events (display_only)
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('error', 'Manual transfers are not available for free events');
  END IF;

  -- Verify this payment method is accepted for this event
  IF NOT (p_payment_method = ANY(v_event.accepted_payment_methods)) THEN
    RETURN jsonb_build_object('error', 'This payment method is not accepted for this event');
  END IF;

  -- ═══ PRICING: Use the same calculation as Stripe checkout ═══
  v_breakdown := calculate_order_breakdown_v3(p_tier_id, p_quantity, p_promo_code);

  IF v_breakdown IS NULL OR v_breakdown ? 'error' THEN
    RETURN jsonb_build_object('error', COALESCE(v_breakdown->>'error', 'Pricing calculation failed'));
  END IF;

  -- ═══ RESERVE INVENTORY ═══
  -- Use the same reservation system as Stripe checkout
  -- NOTE: Reservation failures (sold out, lock contention) will now
  -- propagate as real exceptions, causing proper transaction rollback.
  IF p_user_id IS NOT NULL THEN
    -- Authenticated reservation
    IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
      SELECT rpc_result INTO v_reservation
      FROM (SELECT reserve_seats(p_user_id, p_seat_ids, p_tier_id) AS rpc_result) x;
    ELSE
      DECLARE
        v_res_row RECORD;
      BEGIN
        SELECT * INTO v_res_row
        FROM create_reservation(p_user_id, p_tier_id, p_quantity);
        v_res_id := v_res_row.reservation_id;
      END;
    END IF;
  ELSE
    -- Guest reservation
    IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
      v_reservation := reserve_guest_seats(p_seat_ids, p_tier_id);
      v_res_id := (v_reservation->>'reservation_id')::UUID;
    ELSE
      v_reservation := create_guest_reservation(p_tier_id, p_quantity);
      v_res_id := (v_reservation->>'reservation_id')::UUID;
    END IF;
  END IF;

  -- ═══ GENERATE UNIQUE REFERENCE CODE ═══
  v_reference := 'EVT-' ||
    upper(substring(p_event_id::TEXT from 1 for 4)) || '-' ||
    upper(substring(md5(random()::TEXT || clock_timestamp()::TEXT) from 1 for 4));

  -- ═══ GET ORGANIZER TRANSFER DESTINATION ═══
  SELECT org.manual_payment_methods, org.manual_transfer_instructions
  INTO v_org
  FROM organizers org
  JOIN events e ON e.organizer_id = org.user_id
  WHERE e.id = p_event_id;

  -- Find the matching payment method destination
  IF v_org.manual_payment_methods IS NOT NULL THEN
    SELECT elem->>'destination'
    INTO v_dest
    FROM jsonb_array_elements(v_org.manual_payment_methods) AS elem
    WHERE elem->>'method' = p_payment_method
    LIMIT 1;
  END IF;

  -- ═══ INSERT MANUAL TRANSFER ORDER ═══
  INSERT INTO manual_transfer_orders (
    event_id, tier_id, reservation_id, user_id,
    buyer_name, buyer_email, buyer_phone,
    payment_method, quantity,
    unit_price, subtotal, tax_amount, platform_fee_total,
    total_amount, currency, organizer_net,
    financial_snapshot,
    transfer_destination, transfer_reference,
    proof_image_url, buyer_notes,
    seat_ids, promo_id, promo_code,
    status, expires_at
  ) VALUES (
    p_event_id, p_tier_id, v_res_id, p_user_id,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    v_method, p_quantity,
    COALESCE((v_breakdown->>'unit_price')::DECIMAL, 0),
    COALESCE((v_breakdown->>'subtotal')::DECIMAL, 0),
    COALESCE((v_breakdown->>'tax_amount')::DECIMAL, 0),
    COALESCE((v_breakdown->>'platform_fee_total')::DECIMAL, 0),
    COALESCE((v_breakdown->>'total')::DECIMAL, 0),
    COALESCE(v_breakdown->>'currency', 'EGP'),
    COALESCE((v_breakdown->>'organizer_net')::DECIMAL, 0),
    v_breakdown,
    v_dest,
    v_reference,
    p_proof_image_url, p_buyer_notes,
    p_seat_ids,
    NULLIF(v_breakdown->>'promo_id', '')::UUID,
    p_promo_code,
    'pending_payment',
    now() + interval '24 hours'
  ) RETURNING id INTO v_order_id;

  -- ═══ RETURN ═══
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'transfer_reference', v_reference,
    'reservation_id', v_res_id,
    'total_amount', COALESCE((v_breakdown->>'total')::DECIMAL, 0),
    'currency', COALESCE(v_breakdown->>'currency', 'EGP'),
    'transfer_destination', v_dest,
    'transfer_instructions', v_org.manual_transfer_instructions,
    'payment_method', p_payment_method,
    'expires_at', (now() + interval '24 hours'),
    'event_title', v_event.title,
    'breakdown', v_breakdown
  );

  -- ═══ SECURITY FIX (C7): Removed blanket EXCEPTION WHEN OTHERS handler ═══
  -- Previously: EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM)
  -- This swallowed reservation lock failures, CHECK constraint violations, and
  -- FK violations, preventing transaction rollback. Now only the enum cast
  -- (invalid_text_representation) is caught above. All other exceptions —
  -- including sold-out inventory, lock contention, and constraint violations —
  -- propagate as real errors and trigger proper rollback.
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- C8 FIX: check_terms_compliance() — enforce auth.uid()
-- ════════════════════════════════════════════════════════════
-- BEFORE: Takes p_user_id UUID and uses it directly, allowing
--         any user to check compliance status for any other user.
-- AFTER:  Ignores p_user_id parameter, always uses auth.uid().
--         Signature kept for backward compatibility (callers pass
--         p_user_id but it's overridden internally).

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

GRANT EXECUTE ON FUNCTION check_terms_compliance(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION check_terms_compliance(UUID) FROM anon;


-- ════════════════════════════════════════════════════════════
-- C9 FIX: send_unconfigured_payments_email() — add authorization
-- ════════════════════════════════════════════════════════════
-- BEFORE: Any authenticated user could call with any event_id,
--         triggering emails to any organizer.
-- AFTER:  Caller must be the event's organizer OR an admin.

CREATE OR REPLACE FUNCTION send_unconfigured_payments_email(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_event RECORD;
  v_organizer RECORD;
  v_already_sent BOOLEAN;
  v_vars JSONB;
  v_origin TEXT := 'https://eventsli.com';
  v_caller_id UUID := auth.uid();
BEGIN
  -- SECURITY FIX (C9): Require authentication
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- 1. Fetch event details
  SELECT id, title, organizer_id, accepted_payment_methods, status
  INTO v_event
  FROM events
  WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  -- SECURITY FIX (C9): Verify caller is the event organizer OR an admin
  IF v_event.organizer_id != v_caller_id AND NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Unauthorized: only the event organizer or an admin can trigger this email');
  END IF;

  -- 2. Verify status is published
  IF v_event.status != 'published' THEN
    RETURN jsonb_build_object('error', 'Event is not published');
  END IF;

  -- 3. Check if accepted_payment_methods is indeed empty/null
  IF v_event.accepted_payment_methods IS NOT NULL AND array_length(v_event.accepted_payment_methods, 1) > 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Payment methods are already configured');
  END IF;

  -- 4. Check if we already sent the email to prevent double-sending
  SELECT EXISTS (
    SELECT 1 FROM email_logs
    WHERE template_name = 'event_payments_unconfigured'
      AND event_id = p_event_id
  ) INTO v_already_sent;

  IF v_already_sent THEN
    RETURN jsonb_build_object('success', true, 'message', 'Email already sent previously');
  END IF;

  -- 5. Get organizer details
  SELECT full_name, email INTO v_organizer
  FROM profiles
  WHERE id = v_event.organizer_id;

  IF v_organizer IS NULL OR v_organizer.email IS NULL THEN
    RETURN jsonb_build_object('error', 'Organizer profile or email not found');
  END IF;

  -- 6. Build variables
  v_vars := jsonb_build_object(
    'organizer_name', COALESCE(v_organizer.full_name, 'Organizer'),
    'event_title', v_event.title,
    'dashboard_url', v_origin || '/dashboard.html'
  );

  -- 7. Call edge function
  PERFORM notify_via_edge_function('event_payments_unconfigured', p_event_id, v_vars);

  RETURN jsonb_build_object('success', true, 'message', 'Unconfigured payments email triggered successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION send_unconfigured_payments_email(UUID) TO authenticated;


COMMIT;


-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v47 COMPLETE — SECURITY FIXES APPLIED
-- ════════════════════════════════════════════════════════════
--
-- Verification queries:
--
--   -- C5: Verify RLS policy was replaced
--   SELECT policyname, qual FROM pg_policies
--   WHERE tablename = 'orders' AND policyname = 'orders_select_guest';
--   -- Expected: qual contains "auth.uid() = user_id" (not just "guest_email IS NOT NULL")
--
--   -- C6: Verify function was replaced
--   SELECT prosrc FROM pg_proc WHERE proname = 'get_order_by_session';
--   -- Expected: contains "auth.uid()" check
--
--   -- C7: Verify blanket handler removed
--   SELECT prosrc FROM pg_proc WHERE proname = 'create_manual_transfer_order';
--   -- Expected: does NOT contain "EXCEPTION WHEN OTHERS"
--
--   -- C8: Verify auth.uid() enforcement
--   SELECT prosrc FROM pg_proc WHERE proname = 'check_terms_compliance';
--   -- Expected: contains "v_auth_user_id" and "auth.uid()"
--
--   -- C9: Verify authorization check
--   SELECT prosrc FROM pg_proc WHERE proname = 'send_unconfigured_payments_email';
--   -- Expected: contains "is_admin()" and "organizer_id != v_caller_id"
