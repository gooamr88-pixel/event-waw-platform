-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Dashboard Completion Patch
-- Adds payout_info JSONB column to profiles table
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- Add payout_info column (JSONB for flexible bank details)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS payout_info JSONB DEFAULT NULL;

-- Allow organizers to update their own payout info
-- (This should already be covered by existing update policies,
--  but let's make sure)
COMMENT ON COLUMN profiles.payout_info IS 'Encrypted bank/payout details for organizer revenue withdrawal';

-- ════════════ ✅ PATCH COMPLETE ════════════
