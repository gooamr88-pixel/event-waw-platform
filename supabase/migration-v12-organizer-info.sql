-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW v12 — Add Organizer Information Fields
-- 
-- These columns store information about the event organizer
-- that is displayed on the public event detail page.
-- The organizer info is entered per-event in the Create/Edit form.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- Organizer display name (how they want to be known for this event)
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_name TEXT;

-- Organizer contact email (public-facing, for attendee inquiries)
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_email TEXT;

-- Organizer contact phone
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_phone TEXT;

-- Organizer website URL
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_website TEXT;

-- Organizer bio / description
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_bio TEXT;

-- Organizer logo (storage path or URL)
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_logo_url TEXT;


-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRATION COMPLETE
-- After running this, the Create/Edit Event form will correctly
-- persist and retrieve organizer information including:
--   • Organizer Name
--   • Organizer Email
--   • Organizer Phone
--   • Organizer Website
--   • Organizer Bio
--   • Organizer Logo (organizer_logo_url)
-- ═══════════════════════════════════════════════════════════════
