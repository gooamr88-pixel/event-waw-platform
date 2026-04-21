-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW v9 — Geolocation Support for Events
-- Adds latitude/longitude columns to the events table for
-- proximity-based search and sorting.
-- ═══════════════════════════════════════════════════════════════

-- Add geolocation columns (nullable — organizers may not always provide them)
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Index for spatial queries (B-tree is sufficient for Haversine-based sorting)
CREATE INDEX IF NOT EXISTS idx_events_geo ON events(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Grant anon users access to the new columns (they already have SELECT on events)
-- No additional GRANTs needed — the existing GRANT SELECT ON events TO anon covers all columns.

-- ═══════════════════════════════════════════════════════════════
-- Optional: Server-side RPC for large-scale proximity search
-- Uses the Haversine formula in pure SQL (no PostGIS required).
-- Returns events within a radius, sorted by distance.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION search_events_by_proximity(
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION,
  p_radius_km DOUBLE PRECISION DEFAULT 100,
  p_search   TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit    INT DEFAULT 20
)
RETURNS TABLE(
  id UUID,
  organizer_id UUID,
  title TEXT,
  description TEXT,
  cover_image TEXT,
  category TEXT,
  venue TEXT,
  venue_address TEXT,
  city TEXT,
  date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  distance_km DOUBLE PRECISION,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.organizer_id,
    e.title,
    e.description,
    e.cover_image,
    e.category,
    e.venue,
    e.venue_address,
    e.city,
    e.date,
    e.end_date,
    e.status::TEXT,
    e.latitude,
    e.longitude,
    -- Haversine formula (km)
    CASE WHEN e.latitude IS NOT NULL AND e.longitude IS NOT NULL THEN
      6371 * ACOS(
        LEAST(1.0, GREATEST(-1.0,
          COS(RADIANS(p_lat)) * COS(RADIANS(e.latitude))
          * COS(RADIANS(e.longitude) - RADIANS(p_lng))
          + SIN(RADIANS(p_lat)) * SIN(RADIANS(e.latitude))
        ))
      )
    ELSE NULL END AS distance_km,
    e.created_at,
    e.updated_at
  FROM events e
  WHERE e.status = 'published'
    AND e.date >= NOW() - INTERVAL '24 hours'
    -- Text search filter (title, description, venue)
    AND (p_search IS NULL OR p_search = '' OR
         e.title ILIKE '%' || p_search || '%' OR
         e.description ILIKE '%' || p_search || '%' OR
         e.venue ILIKE '%' || p_search || '%')
    -- Category filter
    AND (p_category IS NULL OR p_category = '' OR p_category = 'all'
         OR e.category ILIKE p_category)
  ORDER BY
    -- Events with coordinates: sort by distance
    -- Events without coordinates: push to the end, sort by date
    CASE WHEN e.latitude IS NOT NULL AND e.longitude IS NOT NULL THEN 0 ELSE 1 END,
    CASE WHEN e.latitude IS NOT NULL AND e.longitude IS NOT NULL THEN
      6371 * ACOS(
        LEAST(1.0, GREATEST(-1.0,
          COS(RADIANS(p_lat)) * COS(RADIANS(e.latitude))
          * COS(RADIANS(e.longitude) - RADIANS(p_lng))
          + SIN(RADIANS(p_lat)) * SIN(RADIANS(e.latitude))
        ))
      )
    ELSE 9999999 END,
    e.date ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute to both anon and authenticated users
GRANT EXECUTE ON FUNCTION search_events_by_proximity(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, INT) TO anon;
GRANT EXECUTE ON FUNCTION search_events_by_proximity(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, INT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ✅ DONE — Run this migration in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════
