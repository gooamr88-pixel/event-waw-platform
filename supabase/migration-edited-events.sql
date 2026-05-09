-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Edited Events Approval Pipeline
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- 1. Add a flag to track if an event has been approved at least once
ALTER TABLE events ADD COLUMN IF NOT EXISTS has_been_approved_before BOOLEAN DEFAULT false;

-- 2. Backfill the flag for all currently approved events
UPDATE events
SET has_been_approved_before = true
WHERE admin_approved = true;

-- 3. Update the admin approval RPC to set this flag
CREATE OR REPLACE FUNCTION admin_approve_event(p_event_id UUID)
RETURNS void AS $func$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE events SET
    admin_approved = true,
    has_been_approved_before = true, -- <--- NEW: Marks the event as previously approved
    admin_rejected_reason = NULL,
    admin_reviewed_at = NOW(),
    admin_reviewed_by = auth.uid()
  WHERE id = p_event_id
    AND status = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found or not in published status';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Modify the RLS policy to allow organizers to reset admin_approved to FALSE when editing
DROP POLICY IF EXISTS "events_update_own" ON events;

CREATE POLICY "events_update_own" ON events FOR UPDATE
  USING (organizer_id = auth.uid())
  WITH CHECK (
    organizer_id = auth.uid()
    AND (
      -- Organizer is allowed to reset it to false (sending to queue)
      admin_approved = false 
      OR 
      -- Or leave it as it was (if they didn't touch it)
      admin_approved IS NOT DISTINCT FROM (
        SELECT e.admin_approved FROM events e WHERE e.id = events.id
      )
    )
  );

-- ✅ MIGRATION COMPLETE
