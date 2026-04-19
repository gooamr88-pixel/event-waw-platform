-- EVENT WAW v5 - Part 2: Guest Functions
-- Run via: node run-migration.js "your-connection-string"

DROP FUNCTION IF EXISTS create_guest_reservation(UUID, INT);
DROP FUNCTION IF EXISTS create_guest_token(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS verify_guest_token(TEXT);

-- ==========================================
-- Function 1: create_guest_reservation
-- ==========================================

CREATE OR REPLACE FUNCTION create_guest_reservation(p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS JSONB AS $func$
DECLARE
  v_name TEXT; v_price DECIMAL; v_eid UUID; v_etitle TEXT; v_oid UUID;
  v_cap INT; v_reserved BIGINT; v_sold BIGINT; v_available INT;
  v_expires TIMESTAMPTZ; v_rid UUID;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  SELECT tt.name, tt.price, tt.event_id, e.title, e.organizer_id, tt.capacity
  INTO v_name, v_price, v_eid, v_etitle, v_oid, v_cap
  FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id FOR UPDATE OF tt;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
  FROM reservations WHERE ticket_tier_id = p_tier_id AND status = 'active';

  SELECT COUNT(*) INTO v_sold
  FROM tickets WHERE ticket_tier_id = p_tier_id AND status IN ('valid','scanned');

  v_available := v_cap - v_reserved - v_sold;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  v_expires := NOW() + INTERVAL '35 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (NULL, p_tier_id, p_quantity, v_expires, 'active')
  RETURNING id INTO v_rid;

  RETURN jsonb_build_object(
    'reservation_id', v_rid, 'expires_at', v_expires,
    'tier_name', v_name, 'tier_price', v_price,
    'event_title', v_etitle, 'event_id', v_eid, 'organizer_id', v_oid
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==========================================
-- Function 2: create_guest_token
-- ==========================================

CREATE OR REPLACE FUNCTION create_guest_token(p_order_id UUID, p_email TEXT, p_raw_token TEXT)
RETURNS UUID AS $func$
DECLARE v_token_id UUID;
BEGIN
  INSERT INTO guest_tokens (order_id, token_hash, email, expires_at)
  VALUES (
    p_order_id,
    encode(digest(p_raw_token, 'sha256'), 'hex'),
    p_email,
    now() + interval '90 days'
  )
  RETURNING id INTO v_token_id;
  RETURN v_token_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==========================================
-- Function 3: verify_guest_token
-- ==========================================

CREATE OR REPLACE FUNCTION verify_guest_token(p_token_hash TEXT)
RETURNS JSONB AS $func$
DECLARE
  v_tid UUID; v_oid UUID; v_exp TIMESTAMPTZ;
  v_used INT; v_max INT; v_email TEXT; v_gname TEXT;
BEGIN
  SELECT gt.id, gt.order_id, gt.expires_at, gt.used_count, gt.max_uses,
         o.guest_email, o.guest_name
  INTO v_tid, v_oid, v_exp, v_used, v_max, v_email, v_gname
  FROM guest_tokens gt JOIN orders o ON o.id = gt.order_id
  WHERE gt.token_hash = p_token_hash LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  IF v_exp < now() THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  IF v_used >= v_max THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  UPDATE guest_tokens SET used_count = used_count + 1 WHERE id = v_tid;

  RETURN jsonb_build_object(
    'order_id', v_oid, 'guest_email', v_email,
    'guest_name', v_gname, 'is_valid', true
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
