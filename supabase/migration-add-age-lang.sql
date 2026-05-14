-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add age_policy and language columns to events table
-- Idempotent — safe to run multiple times.
-- 
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Add age_policy column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'age_policy'
  ) THEN
    ALTER TABLE public.events ADD COLUMN age_policy TEXT;
    RAISE NOTICE '✅ Column age_policy added to events table.';
  ELSE
    RAISE NOTICE '⏭️ Column age_policy already exists — skipping.';
  END IF;

  -- Add language column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'language'
  ) THEN
    ALTER TABLE public.events ADD COLUMN language TEXT;
    RAISE NOTICE '✅ Column language added to events table.';
  ELSE
    RAISE NOTICE '⏭️ Column language already exists — skipping.';
  END IF;
END $$;
