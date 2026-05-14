-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add short_description column to events table
-- Idempotent — safe to run multiple times.
-- 
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add the column (if it doesn't already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'short_description'
  ) THEN
    ALTER TABLE public.events
      ADD COLUMN short_description TEXT;

    COMMENT ON COLUMN public.events.short_description
      IS 'A brief summary of the event (max ~200 chars). Shown on event cards and as the primary blurb.';

    RAISE NOTICE '✅ Column short_description added to events table.';
  ELSE
    RAISE NOTICE '⏭️ Column short_description already exists — skipping.';
  END IF;
END $$;
