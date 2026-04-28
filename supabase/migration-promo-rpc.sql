-- ═══════════════════════════════════════════
-- Promo Code Usage RPC
-- Atomically increments used_count on a promo code
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_promo_usage(p_promo_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE promo_codes
  SET used_count = COALESCE(used_count, 0) + 1,
      updated_at = NOW()
  WHERE id = p_promo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_promo_usage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_promo_usage(UUID) TO service_role;

-- ═══════════════════════════════════════════
-- Also grant anon SELECT on promo_codes so guests
-- can validate codes on the event detail page
-- ═══════════════════════════════════════════

-- Allow anon to read active promo_codes (needed for guest promo validation)
DROP POLICY IF EXISTS "promo_codes_select_anon" ON promo_codes;
CREATE POLICY "promo_codes_select_anon" ON promo_codes
  FOR SELECT USING (is_active = true);

-- Grant anon select
GRANT SELECT ON promo_codes TO anon;
