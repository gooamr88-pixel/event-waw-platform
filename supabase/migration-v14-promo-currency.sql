-- ═══════════════════════════════════════════════════════════
-- EVENT WAW — Migration V14: Promo Code Currency Support
-- Adds discount_currency column to promo_codes table
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════

-- Add currency column for fixed-amount promo codes
ALTER TABLE promo_codes 
ADD COLUMN IF NOT EXISTS discount_currency TEXT DEFAULT 'USD';

-- Ensure discount_type and discount_value columns exist (should already from p1-patch)
-- If they don't exist, uncomment:
-- ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed'));
-- ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2) DEFAULT 0;

-- ✅ Migration complete
