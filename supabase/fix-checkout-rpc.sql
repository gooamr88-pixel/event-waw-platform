-- ═══════════════════════════════════════════
-- FIX: Restore get_order_by_session RPC
-- The p1-patch broke this function for guests.
-- This restores the v6 version that works for
-- BOTH authenticated users AND guests.
-- ═══════════════════════════════════════════
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run

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

-- Allow both auth and anon users
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO anon;
