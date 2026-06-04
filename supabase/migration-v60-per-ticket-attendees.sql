-- ═══════════════════════════════════════════════════════════════
-- MIGRATION v60: Per-Ticket Attendee Details
-- ═══════════════════════════════════════════════════════════════
-- Enables collecting individual attendee information (name, email,
-- phone) for each ticket in a multi-ticket order. Previously,
-- attendee data was only order-level (guest_name/email/phone).
--
-- Changes:
--   1. Add attendee_phone column to tickets table
--   2. Add attendee_data JSONB column to reservations table
--   3. Update fulfill_checkout RPC to set per-ticket attendee fields
--
-- ⚠️ SAFE TO RUN: Idempotent. Uses IF NOT EXISTS / CREATE OR REPLACE.
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- 1. Add attendee_phone to tickets table
-- ════════════════════════════════════════════════════════════
-- attendee_name and attendee_email already exist (added in v30).
-- This adds the missing phone field for complete attendee data.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attendee_phone TEXT;

COMMENT ON COLUMN tickets.attendee_phone IS
  'v60: Phone number of the individual ticket holder. '
  'Set during checkout when buyer provides per-ticket attendee details, '
  'or updated via ticket transfer.';


-- ════════════════════════════════════════════════════════════
-- 2. Add attendee_data JSONB to reservations table
-- ════════════════════════════════════════════════════════════
-- Stores per-ticket attendee details during checkout, before payment.
-- The webhook reads this data when fulfilling the order.
-- This avoids Stripe metadata size limits (500 chars/value).

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS attendee_data JSONB DEFAULT NULL;

COMMENT ON COLUMN reservations.attendee_data IS
  'v60: JSON array of per-ticket attendee details. '
  'Format: [{"name":"...", "email":"...", "phone":"..."}, ...] '
  'Stored during checkout, read by webhook during fulfillment. '
  'Bypasses Stripe metadata 500-char limit.';


-- ════════════════════════════════════════════════════════════
-- 3. Update fulfill_checkout to read per-ticket attendee data
-- ════════════════════════════════════════════════════════════
-- The p_tickets JSONB array now may contain attendee_name,
-- attendee_email, attendee_phone fields per ticket object.

CREATE OR REPLACE FUNCTION fulfill_checkout(
  p_session_id         TEXT,
  p_payment_intent     TEXT,
  p_amount_total_cents INT,
  p_currency           TEXT,
  p_reservation_id     UUID,
  p_event_id           UUID,
  p_tier_id            UUID,
  p_user_id            UUID,
  p_is_guest           BOOLEAN,
  p_guest_name         TEXT DEFAULT '',
  p_guest_email        TEXT DEFAULT '',
  p_guest_phone        TEXT DEFAULT '',
  p_tickets            JSONB DEFAULT '[]',
  p_financial          JSONB DEFAULT '{}',
  p_promo_id           UUID DEFAULT NULL,
  p_seat_ids           UUID[] DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_existing UUID;
  v_org_id   UUID;
  v_linked_user_id UUID;
BEGIN
  -- ═══ IDEMPOTENCY GUARD ═══
  -- P1-4 FIX: FOR UPDATE prevents concurrent webhook retries from
  -- both seeing NULL and creating duplicate orders.
  SELECT id INTO v_existing
  FROM orders
  WHERE stripe_session_id = p_session_id
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', true, 'order_id', v_existing);
  END IF;

  -- ═══ 1. CREATE ORDER ═══
  INSERT INTO orders (
    event_id, reservation_id, stripe_session_id, stripe_payment_intent,
    amount, currency, status,
    user_id, is_guest, guest_name, guest_email, guest_phone,
    subtotal, tax_amount, tax_rate_snapshot, platform_fee_amount,
    pdf_status
  ) VALUES (
    p_event_id, p_reservation_id, p_session_id, p_payment_intent,
    p_amount_total_cents / 100.0, p_currency, 'paid',
    CASE WHEN p_is_guest THEN NULL ELSE p_user_id END,
    p_is_guest,
    COALESCE(p_guest_name, ''),
    COALESCE(p_guest_email, ''),
    COALESCE(p_guest_phone, ''),
    COALESCE((p_financial->>'subtotal')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_amount')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_rate')::DECIMAL, 0),
    COALESCE((p_financial->>'platform_fee_amount')::DECIMAL,
             (p_financial->>'platform_fee_total')::DECIMAL, 0),
    'pending'
  ) RETURNING id INTO v_order_id;

  -- ═══ V-03 FIX: LINK GUEST ORDERS TO EXISTING ACCOUNTS ═══
  IF p_is_guest AND COALESCE(p_guest_email, '') != '' THEN
    SELECT id INTO v_linked_user_id
    FROM profiles
    WHERE LOWER(email) = LOWER(p_guest_email)
    LIMIT 1;

    IF v_linked_user_id IS NOT NULL THEN
      UPDATE orders SET user_id = v_linked_user_id WHERE id = v_order_id;
      RAISE NOTICE 'V-03: Linked guest order % to existing user %', v_order_id, v_linked_user_id;
    END IF;
  END IF;

  -- ═══ 2. CREATE TICKETS (atomic with order) ═══
  -- v60: Now reads attendee_name, attendee_email, attendee_phone from p_tickets JSONB
  INSERT INTO tickets (
    id, order_id, ticket_tier_id, user_id, qr_hash, status, seat_label,
    attendee_name, attendee_email, attendee_phone
  )
  SELECT
    (t->>'id')::UUID,
    v_order_id,
    p_tier_id,
    CASE WHEN p_is_guest THEN COALESCE(v_linked_user_id, NULL) ELSE p_user_id END,
    t->>'qr_hash',
    'valid',
    NULLIF(t->>'seat_label', ''),
    NULLIF(t->>'attendee_name', ''),
    NULLIF(t->>'attendee_email', ''),
    NULLIF(t->>'attendee_phone', '')
  FROM jsonb_array_elements(p_tickets) AS t;

  -- ═══ 3. CREATE PAYMENT RECORD ═══
  SELECT id INTO v_org_id FROM organizers
  WHERE user_id = NULLIF(p_financial->>'organizer_id', '')::UUID;

  INSERT INTO payments (
    order_id, event_id,
    subtotal, tax_rate_snapshot, tax_amount,
    platform_fee_pct, platform_fee_total,
    total_amount, currency, organizer_net,
    stripe_payment_intent, stripe_charge_id,
    promo_code, promo_discount, tax_inclusive,
    organizer_id, status, paid_at
  ) VALUES (
    v_order_id, p_event_id,
    COALESCE((p_financial->>'subtotal')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_rate')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_amount')::DECIMAL, 0),
    COALESCE((p_financial->>'platform_fee_pct')::DECIMAL, 0),
    COALESCE((p_financial->>'platform_fee_total')::DECIMAL, 0),
    p_amount_total_cents / 100.0,
    p_currency,
    COALESCE((p_financial->>'organizer_net')::DECIMAL, 0),
    COALESCE(p_payment_intent, ''),
    '',
    NULLIF(p_financial->>'promo_code', ''),
    COALESCE((p_financial->>'promo_discount')::DECIMAL, 0),
    COALESCE((p_financial->>'tax_inclusive')::TEXT, 'false') = 'true',
    v_org_id,
    'paid',
    now()
  );

  -- ═══ 4. MARK RESERVATION CONVERTED ═══
  UPDATE reservations SET status = 'converted' WHERE id = p_reservation_id;

  -- ═══ 5. INCREMENT SOLD COUNT ═══
  PERFORM increment_sold_count(p_tier_id, jsonb_array_length(p_tickets));

  -- ═══ 6. CONFIRM SEATS SOLD (if applicable) ═══
  IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
    BEGIN
      PERFORM confirm_seats_sold(
        p_reservation_id,
        ARRAY(SELECT (t->>'id')::UUID FROM jsonb_array_elements(p_tickets) t)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Non-critical: log warning but don't fail the transaction
      RAISE WARNING 'confirm_seats_sold failed: %', SQLERRM;
    END;
  END IF;

  -- ═══ 7. INCREMENT PROMO USAGE ═══
  IF p_promo_id IS NOT NULL THEN
    BEGIN
      PERFORM increment_promo_usage(p_promo_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'increment_promo_usage failed: %', SQLERRM;
    END;
  END IF;

  -- ═══ SUCCESS ═══
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'ticket_count', jsonb_array_length(p_tickets),
    'linked_user_id', v_linked_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;

-- Restore grants (service_role only)
GRANT EXECUTE ON FUNCTION fulfill_checkout(
  TEXT, TEXT, INT, TEXT, UUID, UUID, UUID, UUID, BOOLEAN,
  TEXT, TEXT, TEXT, JSONB, JSONB, UUID, UUID[]
) TO service_role;

REVOKE EXECUTE ON FUNCTION fulfill_checkout(
  TEXT, TEXT, INT, TEXT, UUID, UUID, UUID, UUID, BOOLEAN,
  TEXT, TEXT, TEXT, JSONB, JSONB, UUID, UUID[]
) FROM authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- 4. Update transfer_ticket to also handle attendee_phone
-- ════════════════════════════════════════════════════════════
-- The existing transfer_ticket function sets attendee_name and
-- attendee_email but not attendee_phone. We update it to clear
-- the phone on transfer (since the new holder's phone is unknown).

DO $$ BEGIN
  -- Only update if the function exists
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'transfer_ticket') THEN
    EXECUTE '
      CREATE OR REPLACE FUNCTION transfer_ticket(
        p_ticket_id UUID,
        p_new_email TEXT,
        p_new_name  TEXT
      ) RETURNS JSONB AS $fn$
      DECLARE
        v_ticket RECORD;
        v_new_qr TEXT;
        v_nonce  UUID;
      BEGIN
        SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
        IF v_ticket IS NULL THEN
          RAISE EXCEPTION ''Ticket not found'';
        END IF;
        IF v_ticket.status != ''valid'' THEN
          RAISE EXCEPTION ''Cannot transfer: ticket status is %'', v_ticket.status;
        END IF;

        -- Generate new QR hash (invalidates old one)
        v_nonce := gen_random_uuid();
        v_new_qr := jsonb_build_object(
          ''v'', 2,
          ''ticket_id'', p_ticket_id,
          ''nonce'', v_nonce,
          ''transferred'', true,
          ''iat'', EXTRACT(EPOCH FROM now())::BIGINT
        )::TEXT;

        UPDATE tickets SET
          attendee_name  = p_new_name,
          attendee_email = p_new_email,
          attendee_phone = NULL,  -- v60: Clear phone on transfer
          qr_hash        = v_new_qr
        WHERE id = p_ticket_id;

        RETURN jsonb_build_object(
          ''success'', true,
          ''ticket_id'', p_ticket_id,
          ''new_attendee'', p_new_name
        );
      END;
      $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;
    ';
    RAISE NOTICE 'v60: Updated transfer_ticket to clear attendee_phone';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'v60: transfer_ticket update skipped: %', SQLERRM;
END $$;


-- ════════════════════════════════════════════════════════════
-- ✅ VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════

SELECT 'v60-1: attendee_phone column' AS check_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'attendee_phone'
  ) AS passed;

SELECT 'v60-2: attendee_data column' AS check_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reservations' AND column_name = 'attendee_data'
  ) AS passed;

SELECT 'v60-3: fulfill_checkout reads attendee_name' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'fulfill_checkout') LIKE '%attendee_name%' AS passed;

SELECT 'v60-4: fulfill_checkout reads attendee_phone' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'fulfill_checkout') LIKE '%attendee_phone%' AS passed;


-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRATION v60 COMPLETE — PER-TICKET ATTENDEE DETAILS
-- ═══════════════════════════════════════════════════════════════
