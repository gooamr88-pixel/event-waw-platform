-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add policies column to events table
-- Idempotent — safe to run multiple times.
-- 
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Add policies column (JSONB to store refund_policy, cancellation_policy, etc.)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'policies'
  ) THEN
    ALTER TABLE public.events ADD COLUMN policies JSONB DEFAULT '{}'::jsonb;
    RAISE NOTICE '✅ Column policies added to events table.';
  ELSE
    RAISE NOTICE '⏭️ Column policies already exists — skipping.';
  END IF;
END $$;
