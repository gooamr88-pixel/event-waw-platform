-- ═══════════════════════════════════
-- EVENT WAW — RLS Policy Fixes
-- Apply these after the original rls-policies.sql
-- ═══════════════════════════════════

-- ══════════════════════════════════
-- FIX A-5: ticket_tiers — Allow anonymous access for published events
-- The original policy used auth.uid() which returns NULL for anon users,
-- blocking unauthenticated browsing of events.
-- ══════════════════════════════════

-- Drop the existing policy
DROP POLICY IF EXISTS "Public can view tiers of published events" ON ticket_tiers;

-- Create a new policy that allows:
-- 1. Anonymous users to see tiers of published events
-- 2. Organizers to see tiers of their own events (including drafts)
CREATE POLICY "Public can view tiers of published events"
  ON ticket_tiers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.status = 'published'
    )
    OR (
      auth.uid() IS NOT NULL AND
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = ticket_tiers.event_id
        AND e.organizer_id = auth.uid()
      )
    )
  );

-- ══════════════════════════════════
-- FIX S-8: profiles — Restrict organizer read access
-- Currently any organizer can read ALL profiles.
-- Fix: organizers can only see profiles of users who bought
-- tickets for their events.
-- ══════════════════════════════════

DROP POLICY IF EXISTS "Organizers can view attendee profiles" ON profiles;

CREATE POLICY "Organizers can view attendee profiles for their events"
  ON profiles FOR SELECT
  USING (
    -- Users can always see their own profile
    auth.uid() = id
    OR
    -- Organizers can see attendees of their events only
    (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.role = 'organizer'
      )
      AND EXISTS (
        SELECT 1 FROM tickets t
        JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
        JOIN events e ON e.id = tt.event_id
        WHERE t.user_id = profiles.id
        AND e.organizer_id = auth.uid()
      )
    )
  );

-- ══════════════════════════════════
-- Ensure anon can SELECT on public-facing tables
-- ══════════════════════════════════
GRANT SELECT ON events TO anon;
GRANT SELECT ON ticket_tiers TO anon;
