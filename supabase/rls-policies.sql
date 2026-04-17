-- ═══════════════════════════════════════════════
-- EVENT WAW — Row Level Security Policies
-- ═══════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════
-- PROFILES
-- ══════════════════════════════════

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow service role to insert (via trigger)
CREATE POLICY "Service role can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- Organizers can view attendee names (for scanner)
CREATE POLICY "Organizers can view attendee profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.organizer_id = auth.uid()
    )
  );

-- ══════════════════════════════════
-- EVENTS
-- ══════════════════════════════════

-- Anyone (including anonymous/unauthenticated) can view published events
CREATE POLICY "Public can view published events"
  ON events FOR SELECT
  USING (status = 'published');
-- NOTE: This policy covers both anon and authenticated roles.
-- If it still fails, make sure you GRANT SELECT on events to anon:
--   GRANT SELECT ON events TO anon;

-- Organizers can view all their own events (any status)
CREATE POLICY "Organizers can view own events"
  ON events FOR SELECT
  USING (organizer_id = auth.uid());

-- Organizers can create events
CREATE POLICY "Organizers can create events"
  ON events FOR INSERT
  WITH CHECK (organizer_id = auth.uid());

-- Organizers can update their own events
CREATE POLICY "Organizers can update own events"
  ON events FOR UPDATE
  USING (organizer_id = auth.uid())
  WITH CHECK (organizer_id = auth.uid());

-- Organizers can delete their own draft events
CREATE POLICY "Organizers can delete own draft events"
  ON events FOR DELETE
  USING (organizer_id = auth.uid() AND status = 'draft');

-- ══════════════════════════════════
-- TICKET TIERS
-- ══════════════════════════════════

-- Anyone can view tiers of published events
CREATE POLICY "Public can view tiers of published events"
  ON ticket_tiers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND (e.status = 'published' OR e.organizer_id = auth.uid())
    )
  );

-- Organizers can manage tiers of their events
CREATE POLICY "Organizers can insert tiers"
  ON ticket_tiers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.organizer_id = auth.uid()
    )
  );

CREATE POLICY "Organizers can update tiers"
  ON ticket_tiers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.organizer_id = auth.uid()
    )
  );

CREATE POLICY "Organizers can delete tiers"
  ON ticket_tiers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.organizer_id = auth.uid()
    )
  );

-- ══════════════════════════════════
-- RESERVATIONS
-- ══════════════════════════════════

-- Users can view their own reservations
CREATE POLICY "Users can view own reservations"
  ON reservations FOR SELECT
  USING (user_id = auth.uid());

-- Users can create reservations (via RPC function, but policy needed)
CREATE POLICY "Users can create reservations"
  ON reservations FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ══════════════════════════════════
-- ORDERS
-- ══════════════════════════════════

-- Users can view their own orders
CREATE POLICY "Users can view own orders"
  ON orders FOR SELECT
  USING (user_id = auth.uid());

-- Organizers can view orders for their events
CREATE POLICY "Organizers can view event orders"
  ON orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = orders.event_id
      AND e.organizer_id = auth.uid()
    )
  );

-- ══════════════════════════════════
-- TICKETS
-- ══════════════════════════════════

-- Users can view their own tickets
CREATE POLICY "Users can view own tickets"
  ON tickets FOR SELECT
  USING (user_id = auth.uid());

-- Organizers can view tickets for their events (for scanner/attendee list)
CREATE POLICY "Organizers can view event tickets"
  ON tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_tiers tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = tickets.ticket_tier_id
      AND e.organizer_id = auth.uid()
    )
  );
