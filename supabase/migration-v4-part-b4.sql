-- ──────────── FUNCTION 4: create_reservation (with organizer_id) ────────────
-- Uses := assignment instead of SELECT INTO (Supabase SQL Editor bug)
CREATE OR REPLACE FUNCTION create_reservation(p_user_id UUID, p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE(
  reservation_id UUID, expires_at TIMESTAMPTZ, tier_name TEXT,
  tier_price DECIMAL, event_title TEXT, event_id UUID,
  organizer_id UUID
) AS $func$
DECLARE
  v_id UUID;
  v_name TEXT;
  v_price DECIMAL;
  v_capacity INT;
  v_event_id UUID;
  v_event_title TEXT;
  v_organizer_id UUID;
  v_available INT;
  v_reservation_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  -- Lock the tier row and fetch details using := assignment
  v_id := (SELECT tt.id FROM ticket_tiers tt WHERE tt.id = p_tier_id FOR UPDATE);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  v_name := (SELECT tt.name FROM ticket_tiers tt WHERE tt.id = p_tier_id);
  v_price := (SELECT tt.price FROM ticket_tiers tt WHERE tt.id = p_tier_id);
  v_capacity := (SELECT tt.capacity FROM ticket_tiers tt WHERE tt.id = p_tier_id);
  v_event_id := (SELECT tt.event_id FROM ticket_tiers tt WHERE tt.id = p_tier_id);
  v_event_title := (SELECT e.title FROM events e JOIN ticket_tiers tt ON e.id = tt.event_id WHERE tt.id = p_tier_id);
  v_organizer_id := (SELECT e.organizer_id FROM events e JOIN ticket_tiers tt ON e.id = tt.event_id WHERE tt.id = p_tier_id);

  v_available := v_capacity
    - COALESCE((SELECT SUM(r.quantity)::INT FROM reservations r WHERE r.ticket_tier_id = p_tier_id AND r.status = 'active'), 0)
    - COALESCE((SELECT COUNT(*)::INT FROM tickets t WHERE t.ticket_tier_id = p_tier_id AND t.status IN ('valid','scanned')), 0);

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  v_expires := NOW() + INTERVAL '35 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT v_reservation_id, v_expires, v_name, v_price,
    v_event_title, v_event_id, v_organizer_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
