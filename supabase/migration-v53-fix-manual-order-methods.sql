-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v53: Fix Manual Transfer Accepted Methods Gate
-- Date: 2026-06-01
--
-- ROOT CAUSE:
--   The database RPC `create_manual_transfer_order` had a strict check:
--     IF NOT (p_payment_method = ANY(v_event.accepted_payment_methods)) THEN
--       RETURN jsonb_build_object('error', 'This payment method is not accepted for this event');
--     END IF;
--
--   However, by default events are published with `accepted_payment_methods = ARRAY['stripe']`.
--   To keep manual payments functional, the frontend dynamically merges any manual payment methods
--   configured in the organizer's profile *after* the event is published (using `get_event_payment_config`).
--   Because the database didn't apply this merge logic, manual orders were rejected with a 400 Bad Request
--   by the database layer if the event wasn't published with the manual methods explicitly selected.
--
-- FIX:
--   Redefine `create_manual_transfer_order` to load the organizer's manual payment settings *before*
--   performing the method check. A manual payment method is accepted if:
--     1. It is explicitly listed in `v_event.accepted_payment_methods`
--     2. OR it has a configured destination in `organizers.manual_payment_methods` (meaning `v_dest IS NOT NULL`).
--
-- ⚠️ SAFE TO RUN: Purely additive / update to existing RPC. No data loss.
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

BEGIN;

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

  -- Verify this payment method is accepted/configured (support dynamic merging of organizer manual methods)
  IF NOT (p_payment_method = ANY(v_event.accepted_payment_methods)) AND v_dest IS NULL THEN
    RETURN jsonb_build_object('error', 'This payment method is not accepted or configured for this event');
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
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
