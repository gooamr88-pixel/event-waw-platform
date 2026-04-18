-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Migration v4 — PART A (Run FIRST)
-- Non-function statements: Policies, Columns, Indexes
-- ═══════════════════════════════════════════════════════════════

-- 1. CRITICAL: Lock Role Column
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role IS NOT DISTINCT FROM (SELECT p.role FROM profiles p WHERE p.id = auth.uid())
  );

-- 2. Remove Dead OTP INSERT Policy
DROP POLICY IF EXISTS "otps_insert" ON login_otps;

-- 3. Stripe Connect Columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT false;

-- 4. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_tier_valid
  ON tickets(ticket_tier_id) WHERE status IN ('valid', 'scanned');

CREATE INDEX IF NOT EXISTS idx_reservations_active
  ON reservations(ticket_tier_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_orders_payment_intent
  ON orders(stripe_payment_intent);

CREATE INDEX IF NOT EXISTS idx_events_organizer_date
  ON events(organizer_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_events_published_date
  ON events(date ASC) WHERE status = 'published';

-- 5. Drop old function signature (needed before re-creating with new return type)
DROP FUNCTION IF EXISTS create_reservation(UUID, UUID, INT);
