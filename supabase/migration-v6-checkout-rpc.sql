-- EVENT WAW v6 — Checkout Result RPC
-- Allows the checkout-success page to fetch order + ticket data
-- using the Stripe session_id (works for both guests and auth users).
-- SECURITY: Session IDs are long random strings only known to the buyer.

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
