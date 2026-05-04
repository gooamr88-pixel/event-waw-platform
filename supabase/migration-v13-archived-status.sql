-- ╔══════════════════════════════════════════════════════════╗
-- ║  Migration v13 — Add 'archived' to event_status ENUM   ║
-- ║  Run this in: Supabase Dashboard → SQL Editor           ║
-- ╚══════════════════════════════════════════════════════════╝

-- Add 'archived' value to the event_status enum type
-- ALTER TYPE ... ADD VALUE is idempotent-safe with IF NOT EXISTS
ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'archived';

-- Update RLS policy to allow organizers to archive their own events
-- (They can already update status, but let's ensure it's explicit)

-- Done! The events.status column now accepts 'archived' as a valid value.
-- Archived events are:
--   • Hidden from the public landing page (getEvents filters status = 'published')
--   • Visible in the dashboard Archives panel
--   • Restorable to 'draft' status at any time
