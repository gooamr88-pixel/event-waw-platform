-- EVENT WAW v7 — Add missing event detail fields
-- Adds doors_open time and terms/conditions support

ALTER TABLE events ADD COLUMN IF NOT EXISTS doors_open TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS terms_conditions TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'English';
