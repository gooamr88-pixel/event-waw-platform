-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW v11 — Add Extended Event Fields
-- 
-- These columns are required by the dashboard Create/Edit Event
-- form but were never added to the database schema.
-- Without them, event data (images, sponsors, settings) cannot
-- be persisted and the edit form appears empty.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- Listing type: 'display_only' or 'display_and_sell'
ALTER TABLE events ADD COLUMN IF NOT EXISTS listing_type TEXT DEFAULT 'display_and_sell';

-- Event logo (storage path or URL)
ALTER TABLE events ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Gallery image URLs (array stored as JSONB)
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_urls JSONB DEFAULT '[]'::jsonb;

-- Sponsor logo URLs (array stored as JSONB)
ALTER TABLE events ADD COLUMN IF NOT EXISTS sponsor_urls JSONB DEFAULT '[]'::jsonb;

-- Country code (ISO 3166-1 alpha-2, e.g. 'EG', 'SA', 'US')
ALTER TABLE events ADD COLUMN IF NOT EXISTS country TEXT;

-- Keywords for search & SEO (array stored as JSONB)
ALTER TABLE events ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]'::jsonb;

-- Facebook / tracking pixel code
ALTER TABLE events ADD COLUMN IF NOT EXISTS pixel_code TEXT;

-- Event currency (ISO 4217, e.g. 'EGP', 'USD', 'SAR')
ALTER TABLE events ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EGP';

-- IANA timezone (e.g. 'Africa/Cairo', 'America/New_York')
ALTER TABLE events ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Whether to show end time on the public event page
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_end_time BOOLEAN DEFAULT true;

-- Event website URL
ALTER TABLE events ADD COLUMN IF NOT EXISTS website TEXT;

-- Social media links (array of {platform, url} objects stored as JSONB)
ALTER TABLE events ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '[]'::jsonb;

-- ═══════════════════════════════════════════════════════════════
-- Also add currency column to ticket_tiers if not present
-- (the create/edit form stores per-tier currency)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS ticket_type TEXT DEFAULT 'normal';
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS early_bird_price DECIMAL(10,2);
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS early_bird_end TIMESTAMPTZ;
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS max_scans INT DEFAULT 1;
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EGP';


-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRATION COMPLETE
-- After running this, the Create/Edit Event form will correctly
-- persist and retrieve all event data including:
--   • Main photo (cover_image — already exists)
--   • Event logo (logo_url)
--   • Gallery images (gallery_urls)
--   • Sponsor logos (sponsor_urls)
--   • All settings (listing_type, country, currency, timezone, etc.)
--   • Social links
-- ═══════════════════════════════════════════════════════════════
