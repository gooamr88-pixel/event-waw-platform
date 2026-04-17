-- ═══════════════════════════════════
-- EVENT WAW — Financial Dashboard
-- PostgreSQL Functions for Organizer Revenue Tracking
-- ═══════════════════════════════════

-- ══════════════════════════════════
-- 1. Revenue summary per event (for the organizer)
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION get_organizer_revenue(p_organizer_id UUID)
RETURNS TABLE(
  event_id UUID,
  event_title TEXT,
  event_date TIMESTAMPTZ,
  event_status TEXT,
  total_tickets_sold BIGINT,
  total_capacity BIGINT,
  gross_revenue NUMERIC,
  platform_fee NUMERIC,
  net_revenue NUMERIC,
  scanned_count BIGINT,
  scan_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS event_id,
    e.title::TEXT AS event_title,
    e.date AS event_date,
    e.status::TEXT AS event_status,
    COALESCE((
      SELECT COUNT(*) FROM tickets t
      JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
      WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0)::BIGINT AS total_tickets_sold,
    COALESCE(SUM(tt.capacity), 0)::BIGINT AS total_capacity,
    COALESCE((
      SELECT SUM(tt3.price) FROM tickets t
      JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id
      WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) AS gross_revenue,
    COALESCE((
      SELECT SUM(tt3.price) FROM tickets t
      JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id
      WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) * 0.05 AS platform_fee,
    COALESCE((
      SELECT SUM(tt3.price) FROM tickets t
      JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id
      WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) * 0.95 AS net_revenue,
    COALESCE((
      SELECT COUNT(*) FROM tickets t
      JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
      WHERE tt2.event_id = e.id AND t.status = 'scanned'
    ), 0)::BIGINT AS scanned_count,
    CASE WHEN COALESCE((
      SELECT COUNT(*) FROM tickets t
      JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
      WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) > 0
    THEN ROUND(
      COALESCE((
        SELECT COUNT(*) FROM tickets t
        JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
        WHERE tt2.event_id = e.id AND t.status = 'scanned'
      ), 0)::NUMERIC /
      GREATEST(COALESCE((
        SELECT COUNT(*) FROM tickets t
        JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
        WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')
      ), 1)::NUMERIC, 1) * 100, 1)
    ELSE 0
    END AS scan_rate
  FROM events e
  LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
  WHERE e.organizer_id = p_organizer_id
  GROUP BY e.id, e.title, e.date, e.status
  ORDER BY e.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- 2. Revenue breakdown per tier for a specific event
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION get_event_tier_revenue(p_event_id UUID, p_organizer_id UUID)
RETURNS TABLE(
  tier_id UUID,
  tier_name TEXT,
  tier_price NUMERIC,
  capacity INT,
  sold BIGINT,
  revenue NUMERIC,
  scanned BIGINT
) AS $$
BEGIN
  -- Verify organizer owns this event
  IF NOT EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = p_organizer_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: You do not own this event';
  END IF;

  RETURN QUERY
  SELECT
    tt.id AS tier_id,
    tt.name::TEXT AS tier_name,
    tt.price AS tier_price,
    tt.capacity,
    (SELECT COUNT(*) FROM tickets t
     WHERE t.ticket_tier_id = tt.id
     AND t.status IN ('valid','scanned'))::BIGINT AS sold,
    (SELECT COUNT(*) FROM tickets t
     WHERE t.ticket_tier_id = tt.id
     AND t.status IN ('valid','scanned'))::BIGINT * tt.price AS revenue,
    (SELECT COUNT(*) FROM tickets t
     WHERE t.ticket_tier_id = tt.id
     AND t.status = 'scanned')::BIGINT AS scanned
  FROM ticket_tiers tt
  WHERE tt.event_id = p_event_id
  ORDER BY tt.sort_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- 3. Daily revenue time series (for charts)
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION get_daily_revenue(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE(
  day DATE,
  revenue NUMERIC,
  tickets_sold BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(o.created_at) AS day,
    SUM(o.amount) AS revenue,
    COUNT(DISTINCT t.id)::BIGINT AS tickets_sold
  FROM orders o
  JOIN events e ON e.id = o.event_id
  LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = p_organizer_id
    AND o.status = 'paid'
    AND o.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY DATE(o.created_at)
  ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- 4. Helper: Increment sold_count (called from webhook)
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION increment_sold_count(p_tier_id UUID, p_amount INT)
RETURNS void AS $$
BEGIN
  UPDATE ticket_tiers
  SET sold_count = sold_count + p_amount
  WHERE id = p_tier_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
