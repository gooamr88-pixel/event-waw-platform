-- ──────────── FUNCTION 3: get_organizer_revenue (optimized) ────────────
CREATE OR REPLACE FUNCTION get_organizer_revenue(p_organizer_id UUID)
RETURNS TABLE(
  event_id UUID, event_title TEXT, event_date TIMESTAMPTZ, event_status TEXT,
  total_tickets_sold BIGINT, total_capacity BIGINT, gross_revenue NUMERIC,
  platform_fee NUMERIC, net_revenue NUMERIC, scanned_count BIGINT, scan_rate NUMERIC
) AS $func$
BEGIN
  RETURN QUERY
  WITH ticket_stats AS (
    SELECT
      tt.event_id AS ev_id,
      COUNT(*) FILTER (WHERE t.status IN ('valid','scanned')) AS sold,
      COUNT(*) FILTER (WHERE t.status = 'scanned') AS scanned,
      COALESCE(SUM(tt.price) FILTER (WHERE t.status IN ('valid','scanned')), 0) AS revenue
    FROM tickets t
    JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
    GROUP BY tt.event_id
  ),
  capacity_stats AS (
    SELECT ct.event_id AS ev_id, SUM(ct.capacity)::BIGINT AS total_cap
    FROM ticket_tiers ct GROUP BY ct.event_id
  )
  SELECT
    e.id, e.title::TEXT, e.date, e.status::TEXT,
    COALESCE(ts.sold, 0)::BIGINT,
    COALESCE(cs.total_cap, 0)::BIGINT,
    COALESCE(ts.revenue, 0),
    COALESCE(ts.revenue, 0) * 0.05,
    COALESCE(ts.revenue, 0) * 0.95,
    COALESCE(ts.scanned, 0)::BIGINT,
    CASE WHEN COALESCE(ts.sold, 0) > 0
      THEN ROUND(COALESCE(ts.scanned, 0)::NUMERIC / GREATEST(ts.sold, 1) * 100, 1)
      ELSE 0 END
  FROM events e
  LEFT JOIN ticket_stats ts ON ts.ev_id = e.id
  LEFT JOIN capacity_stats cs ON cs.ev_id = e.id
  WHERE e.organizer_id = p_organizer_id
  ORDER BY e.date DESC;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_organizer_revenue(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_organizer_revenue(UUID) FROM anon;
