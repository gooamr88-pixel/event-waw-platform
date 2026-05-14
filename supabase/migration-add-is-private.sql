-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add is_private column to events table
-- Idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Add is_private column (BOOLEAN)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'is_private'
  ) THEN
    ALTER TABLE public.events ADD COLUMN is_private BOOLEAN DEFAULT false;
    RAISE NOTICE '✅ Column is_private added to events table.';
  ELSE
    RAISE NOTICE '⏭️ Column is_private already exists — skipping.';
  END IF;
END $$;
