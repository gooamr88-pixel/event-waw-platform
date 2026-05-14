-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add performers column to events table
-- Idempotent — safe to run multiple times.
-- 
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Add performers column (JSONB to store array of objects: { name, role, image_url })
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'performers'
  ) THEN
    ALTER TABLE public.events ADD COLUMN performers JSONB DEFAULT '[]'::jsonb;
    RAISE NOTICE '✅ Column performers added to events table.';
  ELSE
    RAISE NOTICE '⏭️ Column performers already exists — skipping.';
  END IF;
END $$;
