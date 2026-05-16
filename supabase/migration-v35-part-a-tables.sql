-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v35 Part A: Tables & Schema Changes
-- Terms Enforcement, Tax-Inclusive Mode, Payout Hardening
--
-- ⚠️ SAFE TO RUN: Purely additive. No data loss.
-- Run BEFORE Part B (RPCs).
-- ═══════════════════════════════════════════════════════════════


-- ════════════ TABLE 1: platform_terms_versions ════════════
-- Registry of all terms versions published by the platform.
-- Only one row per terms_type can have is_current = true.

CREATE TABLE IF NOT EXISTS platform_terms_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code    TEXT NOT NULL UNIQUE,
  terms_type      TEXT NOT NULL DEFAULT 'platform'
                    CHECK (terms_type IN ('platform', 'fee_policy', 'refund_policy', 'merchant_agreement')),
  title           TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  content_url     TEXT,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_terms_versions_current
  ON platform_terms_versions(terms_type) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_terms_versions_code
  ON platform_terms_versions(version_code);

ALTER TABLE platform_terms_versions ENABLE ROW LEVEL SECURITY;

-- Public read (everyone needs to see current terms)
CREATE POLICY "terms_versions_select_all" ON platform_terms_versions
  FOR SELECT USING (true);
-- Only admin can insert/update
CREATE POLICY "terms_versions_admin_insert" ON platform_terms_versions
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "terms_versions_admin_update" ON platform_terms_versions
  FOR UPDATE USING (is_admin());

GRANT SELECT ON platform_terms_versions TO authenticated;
GRANT SELECT ON platform_terms_versions TO anon;
GRANT INSERT, UPDATE ON platform_terms_versions TO authenticated;


-- ════════════ TABLE 2: terms_acceptances ════════════
-- Append-only audit log. Every acceptance is a new row.
-- NO UPDATE/DELETE policies — immutable by design.

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organizer_id    UUID REFERENCES organizers(id) ON DELETE SET NULL,
  terms_type      TEXT NOT NULL DEFAULT 'platform'
                    CHECK (terms_type IN ('platform', 'fee_policy', 'refund_policy', 'merchant_agreement')),
  terms_version   TEXT NOT NULL,
  terms_hash      TEXT,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terms_acc_user ON terms_acceptances(user_id);
CREATE INDEX IF NOT EXISTS idx_terms_acc_org ON terms_acceptances(organizer_id);
CREATE INDEX IF NOT EXISTS idx_terms_acc_version ON terms_acceptances(terms_version);
CREATE INDEX IF NOT EXISTS idx_terms_acc_lookup
  ON terms_acceptances(user_id, terms_type, terms_version);

ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "terms_acc_select_own" ON terms_acceptances
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "terms_acc_select_admin" ON terms_acceptances
  FOR SELECT USING (is_admin());
CREATE POLICY "terms_acc_insert_own" ON terms_acceptances
  FOR INSERT WITH CHECK (user_id = auth.uid());
-- NO UPDATE/DELETE policies — immutable

GRANT SELECT, INSERT ON terms_acceptances TO authenticated;


-- ════════════ ALTER: organizers ════════════

ALTER TABLE organizers ADD COLUMN IF NOT EXISTS
  tax_inclusive BOOLEAN DEFAULT false;

ALTER TABLE organizers ADD COLUMN IF NOT EXISTS
  terms_current_version TEXT;


-- ════════════ ALTER: payments ════════════

ALTER TABLE payments ADD COLUMN IF NOT EXISTS
  tax_inclusive BOOLEAN DEFAULT false;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS
  payout_id UUID REFERENCES payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_payout ON payments(payout_id)
  WHERE payout_id IS NOT NULL;


-- ════════════ TRIGGER: Prevent financial amount mutation ════════════
-- Anti-tamper: once a payment is 'paid', financial columns are frozen.
-- Only 'status' and non-financial fields can be updated.

CREATE OR REPLACE FUNCTION prevent_payment_amount_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'paid' AND (
    NEW.subtotal IS DISTINCT FROM OLD.subtotal OR
    NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR
    NEW.platform_fee_total IS DISTINCT FROM OLD.platform_fee_total OR
    NEW.total_amount IS DISTINCT FROM OLD.total_amount OR
    NEW.organizer_net IS DISTINCT FROM OLD.organizer_net
  ) THEN
    RAISE EXCEPTION 'Cannot modify financial amounts on a paid payment record (id=%)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_immutable_amounts ON payments;
CREATE TRIGGER payments_immutable_amounts
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION prevent_payment_amount_mutation();


-- ════════════ SEED: Initial terms version ════════════
-- Inserts the first platform terms version so the system has something to check.

INSERT INTO platform_terms_versions (version_code, terms_type, title, content_hash, content_url, is_current)
VALUES (
  '2026-05-15-v1',
  'platform',
  'Eventsli Platform Terms & Conditions',
  encode(digest('initial-terms-v1', 'sha256'), 'hex'),
  '/merchant-agreement.html',
  true
)
ON CONFLICT (version_code) DO NOTHING;


-- ════════════ ✅ PART A COMPLETE ════════════
-- Run Part B next for RPCs.
