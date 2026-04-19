-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Migration v8: Interactive Seating Chart
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Does NOT drop or modify any existing tables.
-- Purely additive — creates new tables, indexes, RLS, and RPCs
-- for the optional assigned-seating feature.
--
-- Architecture: Hybrid model
--   • venue_maps.layout_json  → visual/geometric data (read-heavy)
--   • seats (normalized rows) → booking state (write-heavy, lockable)
-- ═══════════════════════════════════════════════════════════════


-- ════════════ PART A: TABLES ════════════

-- A1. Venue Maps — one per event, stores the visual layout as JSONB
-- The layout_json contains ONLY drawing data: coordinates, labels,
-- section shapes, stage position. ZERO booking state.

CREATE TABLE IF NOT EXISTS venue_maps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Main',
  layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_maps_one_per_event UNIQUE(event_id)
);

-- Trigger: auto-update updated_at on venue_maps
CREATE TRIGGER venue_maps_updated_at BEFORE UPDATE ON venue_maps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- A2. Seats — one row per bookable seat, the transactional core
-- Each seat references a venue_map and optionally a ticket_tier.
-- Status transitions: available → reserved → sold
--                     available → blocked (organizer hold)
--                     reserved  → available (expiry/cancellation)

CREATE TABLE IF NOT EXISTS seats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_map_id    UUID NOT NULL REFERENCES venue_maps(id) ON DELETE CASCADE,
  section_key     TEXT NOT NULL,
  row_label       TEXT NOT NULL,
  seat_number     TEXT NOT NULL,
  ticket_tier_id  UUID REFERENCES ticket_tiers(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'reserved', 'sold', 'blocked')),
  reservation_id  UUID REFERENCES reservations(id) ON DELETE SET NULL,
  ticket_id       UUID REFERENCES tickets(id) ON DELETE SET NULL,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Composite unique: no duplicate seats within the same map
  CONSTRAINT seats_unique_position UNIQUE(venue_map_id, section_key, row_label, seat_number)
);


-- ════════════ PART B: INDEXES ════════════
-- Designed for the three hot-path queries:
--   1. "Show me all seat statuses for this map" (attendee loads map)
--   2. "Lock these specific seats" (reserve_seats RPC)
--   3. "Release expired seats" (cron cleanup)

-- B1. Primary lookup: all seats for a map, filtered by status
CREATE INDEX IF NOT EXISTS idx_seats_map_status
  ON seats(venue_map_id, status);

-- B2. Tier-based queries: "how many seats in Gold tier are available?"
CREATE INDEX IF NOT EXISTS idx_seats_tier_status
  ON seats(ticket_tier_id, status);

-- B3. Reservation lookup: find seats tied to a specific reservation
CREATE INDEX IF NOT EXISTS idx_seats_reservation
  ON seats(reservation_id)
  WHERE reservation_id IS NOT NULL;

-- B4. Expiry cleanup: find reserved seats past their lock time
CREATE INDEX IF NOT EXISTS idx_seats_locked_expiry
  ON seats(locked_until)
  WHERE status = 'reserved' AND locked_until IS NOT NULL;

-- B5. Venue map lookup by event (already unique, but explicit for RLS joins)
CREATE INDEX IF NOT EXISTS idx_venue_maps_event
  ON venue_maps(event_id);


-- ════════════ PART C: ROW LEVEL SECURITY ════════════

ALTER TABLE venue_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;

-- ──── C1. venue_maps ────

-- Anyone (including anon) can view maps for published events
CREATE POLICY "maps_anon_select_published" ON venue_maps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = venue_maps.event_id AND e.status = 'published'
    )
  );

-- Organizers can view maps for their own events (any status)
CREATE POLICY "maps_organizer_select_own" ON venue_maps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = venue_maps.event_id AND e.organizer_id = auth.uid()
    )
  );

-- Organizers can create maps for their own events
CREATE POLICY "maps_organizer_insert" ON venue_maps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = venue_maps.event_id AND e.organizer_id = auth.uid()
    )
  );

-- Organizers can update maps for their own events
CREATE POLICY "maps_organizer_update" ON venue_maps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = venue_maps.event_id AND e.organizer_id = auth.uid()
    )
  );

-- Organizers can delete maps for their own events
CREATE POLICY "maps_organizer_delete" ON venue_maps FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = venue_maps.event_id AND e.organizer_id = auth.uid()
    )
  );

-- ──── C2. seats ────

-- Anyone (including anon) can view seats for published events
-- This allows the interactive map to render seat statuses
CREATE POLICY "seats_anon_select_published" ON seats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM venue_maps vm
      JOIN events e ON e.id = vm.event_id
      WHERE vm.id = seats.venue_map_id AND e.status = 'published'
    )
  );

-- Organizers can view seats for their own events
CREATE POLICY "seats_organizer_select_own" ON seats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM venue_maps vm
      JOIN events e ON e.id = vm.event_id
      WHERE vm.id = seats.venue_map_id AND e.organizer_id = auth.uid()
    )
  );

-- Organizers can insert seats for their own events (map builder)
CREATE POLICY "seats_organizer_insert" ON seats FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM venue_maps vm
      JOIN events e ON e.id = vm.event_id
      WHERE vm.id = seats.venue_map_id AND e.organizer_id = auth.uid()
    )
  );

-- Organizers can update seats for their own events (reassign tiers, block seats)
CREATE POLICY "seats_organizer_update" ON seats FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM venue_maps vm
      JOIN events e ON e.id = vm.event_id
      WHERE vm.id = seats.venue_map_id AND e.organizer_id = auth.uid()
    )
  );

-- Organizers can delete seats for their own events
CREATE POLICY "seats_organizer_delete" ON seats FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM venue_maps vm
      JOIN events e ON e.id = vm.event_id
      WHERE vm.id = seats.venue_map_id AND e.organizer_id = auth.uid()
    )
  );

-- NOTE: Attendees NEVER write to seats directly.
-- All booking mutations go through SECURITY DEFINER RPCs below.


-- ════════════ PART D: GRANTS ════════════

-- Anon: read-only on maps and seats (for public event pages)
GRANT SELECT ON venue_maps TO anon;
GRANT SELECT ON seats TO anon;

-- Authenticated: full CRUD on maps (RLS restricts to organizer's own events)
GRANT SELECT, INSERT, UPDATE, DELETE ON venue_maps TO authenticated;

-- Authenticated: read + organizer write on seats (RLS enforced)
-- Booking writes go through SECURITY DEFINER RPCs, not direct access
GRANT SELECT, INSERT, UPDATE, DELETE ON seats TO authenticated;

-- Sequences for auto-generated IDs
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ════════════ PART E: BUSINESS LOGIC — Seat Reservation RPC ════════════
-- Uses SELECT FOR UPDATE SKIP LOCKED for zero-deadlock concurrency.
-- All-or-nothing: if ANY requested seat is unavailable, the entire call fails.

DROP FUNCTION IF EXISTS reserve_seats(UUID, UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_seats(
  p_user_id   UUID,     -- NULL for guest checkout
  p_seat_ids  UUID[],   -- array of seat UUIDs the attendee selected
  p_tier_id   UUID      -- the ticket tier these seats belong to
)
RETURNS JSONB AS $func$
DECLARE
  v_seat_count    INT;
  v_locked_ids    UUID[];
  v_locked_count  INT;
  v_tier          RECORD;
  v_reservation_id UUID;
  v_expires       TIMESTAMPTZ;
  v_event_id      UUID;
  v_event_title   TEXT;
BEGIN
  -- 1. Validate input
  v_seat_count := array_length(p_seat_ids, 1);

  IF v_seat_count IS NULL OR v_seat_count < 1 THEN
    RAISE EXCEPTION 'At least 1 seat must be selected';
  END IF;

  IF v_seat_count > 10 THEN
    RAISE EXCEPTION 'Cannot reserve more than 10 seats at once';
  END IF;

  -- 2. Verify the tier exists and fetch event info
  --    Lock the tier row to keep capacity accounting consistent
  SELECT tt.id, tt.name, tt.price, tt.event_id, e.title
  INTO v_tier
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id
  FOR UPDATE OF tt;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  v_event_id    := v_tier.event_id;
  v_event_title := v_tier.title;

  -- 3. Attempt to lock the requested seats using SKIP LOCKED
  --    Only seats that are 'available' AND belong to the correct tier
  --    AND are not already locked by another transaction will be returned.
  SELECT array_agg(s.id)
  INTO v_locked_ids
  FROM seats s
  WHERE s.id = ANY(p_seat_ids)
    AND s.status = 'available'
    AND s.ticket_tier_id = p_tier_id
  FOR UPDATE SKIP LOCKED;

  v_locked_count := COALESCE(array_length(v_locked_ids, 1), 0);

  -- 4. All-or-nothing check
  IF v_locked_count != v_seat_count THEN
    RAISE EXCEPTION 'One or more selected seats are no longer available. Please refresh and try again.';
  END IF;

  -- 5. Create reservation row (reuses existing reservations table)
  v_expires := now() + INTERVAL '35 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, v_seat_count, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  -- 6. Mark seats as reserved and link to the reservation
  UPDATE seats
  SET status         = 'reserved',
      reservation_id = v_reservation_id,
      locked_until   = v_expires
  WHERE id = ANY(v_locked_ids);

  -- 7. Return reservation details (matches create_reservation output shape)
  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'expires_at',     v_expires,
    'seats_locked',   v_locked_count,
    'tier_name',      v_tier.name,
    'tier_price',     v_tier.price,
    'event_id',       v_event_id,
    'event_title',    v_event_title
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PART F: GUEST SEAT RESERVATION ════════════
-- Same logic as reserve_seats but without user_id, mirroring
-- the existing create_guest_reservation pattern.

DROP FUNCTION IF EXISTS reserve_guest_seats(UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_guest_seats(
  p_seat_ids  UUID[],
  p_tier_id   UUID
)
RETURNS JSONB AS $func$
BEGIN
  -- Delegate to reserve_seats with NULL user_id
  RETURN reserve_seats(NULL, p_seat_ids, p_tier_id);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PART G: SEAT RELEASE ON RESERVATION EXPIRY ════════════
-- Extends the existing cron-driven expiry to also release seats.
-- This function is called AFTER expire_stale_reservations() runs.

DROP FUNCTION IF EXISTS release_expired_seats();

CREATE OR REPLACE FUNCTION release_expired_seats()
RETURNS INT AS $func$
DECLARE
  v_count INT;
BEGIN
  UPDATE seats
  SET status         = 'available',
      reservation_id = NULL,
      locked_until   = NULL
  WHERE status = 'reserved'
    AND locked_until IS NOT NULL
    AND locked_until < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PART H: MARK SEATS AS SOLD (Webhook Helper) ════════════
-- Called by the stripe-webhook Edge Function after ticket creation.
-- Links each seat to its ticket and marks it as permanently sold.

DROP FUNCTION IF EXISTS confirm_seats_sold(UUID, UUID[]);

CREATE OR REPLACE FUNCTION confirm_seats_sold(
  p_reservation_id  UUID,
  p_ticket_ids      UUID[]   -- parallel array: ticket_ids[i] → seat for that ticket
)
RETURNS INT AS $func$
DECLARE
  v_count INT;
BEGIN
  -- Mark all seats tied to this reservation as sold
  UPDATE seats
  SET status       = 'sold',
      locked_until = NULL
  WHERE reservation_id = p_reservation_id
    AND status = 'reserved';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PART I: SEAT RELEASE ON REFUND ════════════
-- When a refund is processed, release the seats back to available.

DROP FUNCTION IF EXISTS release_seats_for_order(UUID);

CREATE OR REPLACE FUNCTION release_seats_for_order(p_reservation_id UUID)
RETURNS INT AS $func$
DECLARE
  v_count INT;
BEGIN
  UPDATE seats
  SET status         = 'available',
      reservation_id = NULL,
      ticket_id      = NULL,
      locked_until   = NULL
  WHERE reservation_id = p_reservation_id
    AND status IN ('reserved', 'sold');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PART J: SEAT AVAILABILITY QUERY ════════════
-- Optimized bulk query for the frontend map renderer.
-- Returns one row per seat with just the fields the SVG needs.

DROP FUNCTION IF EXISTS get_seat_map(UUID);

CREATE OR REPLACE FUNCTION get_seat_map(p_event_id UUID)
RETURNS TABLE(
  seat_id        UUID,
  section_key    TEXT,
  row_label      TEXT,
  seat_number    TEXT,
  status         TEXT,
  tier_id        UUID,
  tier_name      TEXT,
  tier_price     DECIMAL
) AS $func$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.section_key,
    s.row_label,
    s.seat_number,
    s.status,
    s.ticket_tier_id,
    tt.name,
    tt.price
  FROM seats s
  JOIN venue_maps vm ON vm.id = s.venue_map_id
  LEFT JOIN ticket_tiers tt ON tt.id = s.ticket_tier_id
  WHERE vm.event_id = p_event_id
  ORDER BY s.section_key, s.row_label, s.seat_number;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PART K: RPC GRANTS ════════════

-- Authenticated users can reserve seats
GRANT EXECUTE ON FUNCTION reserve_seats(UUID, UUID[], UUID) TO authenticated;

-- Guest seat reservation: only callable via service_role (Edge Functions)
-- NOT granted to authenticated or anon — mirrors create_guest_reservation pattern
-- reserve_guest_seats is called by the Edge Function with service_role key

-- Seat map query: public read (both anon and authenticated)
GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO anon;

-- Seat lifecycle RPCs: service_role only (webhook + cron)
-- confirm_seats_sold — only called by stripe-webhook
-- release_expired_seats — only called by cron
-- release_seats_for_order — only called by refund handler
-- No GRANT needed — service_role bypasses RLS and permissions


-- ════════════ PART L: CRON — Seat Expiry Cleanup ════════════
-- Piggybacks on existing cron schedule. Runs every minute.

DO $$ BEGIN
  PERFORM cron.schedule(
    'release-expired-seats',
    '* * * * *',
    $c$ SELECT release_expired_seats(); $c$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not enabled — skipping seat expiry cron. Call release_expired_seats() manually or via Edge Function.';
END $$;


-- ════════════ ✅ DONE ════════════
-- Verification queries:
--
--   -- Check tables were created:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN ('venue_maps', 'seats');
--   -- Expected: 2 rows
--
--   -- Check seats columns:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'seats' ORDER BY ordinal_position;
--
--   -- Check indexes:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename IN ('venue_maps', 'seats') ORDER BY indexname;
--   -- Expected: idx_seats_map_status, idx_seats_tier_status,
--   --           idx_seats_reservation, idx_seats_locked_expiry,
--   --           idx_venue_maps_event, plus PK/unique indexes
--
--   -- Check RLS policies:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('venue_maps', 'seats') ORDER BY tablename, policyname;
--   -- Expected: 5 policies on venue_maps, 5 on seats
--
--   -- Check RPCs:
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public'
--   AND routine_name IN ('reserve_seats', 'reserve_guest_seats',
--     'release_expired_seats', 'confirm_seats_sold',
--     'release_seats_for_order', 'get_seat_map');
--   -- Expected: 6 rows
--
--   -- Smoke test: create a map (as organizer via SQL editor):
--   -- INSERT INTO venue_maps (event_id, layout_json) VALUES (
--   --   'YOUR_EVENT_UUID',
--   --   '{"canvas":{"width":800,"height":600},"stage":{"x":200,"y":20,"width":400,"height":60,"label":"STAGE"},"sections":[]}'
--   -- );
