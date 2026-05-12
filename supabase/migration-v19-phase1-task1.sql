-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v19 Phase 1 Task 1
-- Creates: organizers, payments, payouts
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Purely additive. Does NOT drop or modify
-- any existing tables, columns, or data.
--
-- BRD Alignment:
--   • Section 8:  ربط حساب السحب للمنظم
--   • Section 6:  الضرائب ورسوم المنصة
--   • Section 18: Organizers, Payments, Payouts tables
-- ═══════════════════════════════════════════════════════════════


-- ════════════ TABLE 1: ORGANIZERS ════════════
-- BRD Section 8: بيانات المنظم وحساب السحب والتحقق
-- One row per organizer. Links to profiles(id).
-- Stores payout method, verification status, and tax config.

CREATE TABLE IF NOT EXISTS organizers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,

  -- Business identity
  business_name     TEXT,
  business_type     TEXT DEFAULT 'individual'
                      CHECK (business_type IN ('individual', 'company', 'nonprofit')),
  tax_id            TEXT,                  -- الرقم الضريبي للمنظم
  country           TEXT,                  -- ISO 3166-1 alpha-2 (e.g. 'EG', 'SA')
  city              TEXT,

  -- Payout method: bank, paypal, or stripe_connect
  payout_method     TEXT DEFAULT 'bank'
                      CHECK (payout_method IN ('bank', 'paypal', 'stripe_connect')),

  -- Bank account details (encrypted at rest by Supabase)
  bank_name         TEXT,
  bank_account_holder TEXT,
  bank_account_number TEXT,
  bank_swift_code   TEXT,
  bank_iban         TEXT,
  bank_currency     TEXT DEFAULT 'USD',

  -- PayPal
  paypal_email      TEXT,

  -- Stripe Connect (mirrors existing profiles.stripe_account_id)
  stripe_account_id TEXT,
  stripe_onboarding_complete BOOLEAN DEFAULT false,

  -- Tax configuration (BRD: الضريبة مسؤولية المنظم)
  tax_enabled       BOOLEAN DEFAULT false,
  tax_rate          DECIMAL(5,2) DEFAULT 0,  -- e.g. 15.00 = 15%
  tax_label         TEXT DEFAULT 'VAT',      -- Label shown to buyer (VAT, GST, etc.)

  -- Platform commission override (NULL = use platform default)
  -- BRD: عمولة المنصة يمكن أن تكون نسبة أو مبلغ ثابت
  custom_commission_pct    DECIMAL(5,2),  -- e.g. 5.00 = 5%
  custom_commission_fixed  DECIMAL(10,2), -- e.g. 1.00 = $1 per ticket

  -- Verification
  is_verified       BOOLEAN DEFAULT false,
  verified_at       TIMESTAMPTZ,
  verified_by       UUID REFERENCES profiles(id),

  -- Terms acceptance (BRD Section 7)
  terms_accepted_at TIMESTAMPTZ,
  terms_version     TEXT,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_organizers_user ON organizers(user_id);
CREATE INDEX IF NOT EXISTS idx_organizers_country ON organizers(country);

-- Auto-update updated_at
CREATE TRIGGER organizers_updated_at BEFORE UPDATE ON organizers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════ TABLE 2: PAYMENTS ════════════
-- BRD Section 6 + 18: تسجيل تفاصيل كل عملية دفع
-- One row per order. Captures the financial snapshot at time of purchase.
-- BRD: "يجب حفظ كل الرسوم والضرائب داخل الطلب حتى لا تتغير بعد الشراء"

CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organizer_id        UUID REFERENCES organizers(id) ON DELETE SET NULL,

  -- Price breakdown (all amounts in the order's currency)
  subtotal            DECIMAL(10,2) NOT NULL DEFAULT 0,   -- سعر التذاكر الأساسي (unit × qty)
  tax_rate_snapshot   DECIMAL(5,2) DEFAULT 0,             -- نسبة الضريبة وقت الشراء
  tax_amount          DECIMAL(10,2) NOT NULL DEFAULT 0,   -- مبلغ الضريبة
  platform_fee_pct    DECIMAL(5,2) DEFAULT 0,             -- نسبة عمولة المنصة وقت الشراء
  platform_fee_fixed  DECIMAL(10,2) DEFAULT 0,            -- مبلغ ثابت للعمولة
  platform_fee_total  DECIMAL(10,2) NOT NULL DEFAULT 0,   -- إجمالي عمولة المنصة
  total_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,   -- المجموع النهائي (subtotal + tax + platform_fee)
  currency            TEXT NOT NULL DEFAULT 'USD',

  -- Net amount for organizer (total - platform_fee - tax if platform collects)
  organizer_net       DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Stripe references
  stripe_payment_intent TEXT,
  stripe_charge_id      TEXT,

  -- Promo code snapshot
  promo_code          TEXT,
  promo_discount      DECIMAL(10,2) DEFAULT 0,

  -- Status
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'disputed')),

  -- Timestamps
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_event ON payments(event_id);
CREATE INDEX IF NOT EXISTS idx_payments_organizer ON payments(organizer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi ON payments(stripe_payment_intent);

-- Auto-update updated_at
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════ TABLE 3: PAYOUTS ════════════
-- BRD Section 8 + 18: سحوبات المنظم
-- "دعم تأخير الدفع للمنظم إلى ما بعد انتهاء الحدث"
-- "صفحة للمنظم تعرض: إجمالي المبيعات، الضرائب، رسوم المنصة،
--  المبالغ القابلة للسحب، المبالغ قيد الانتظار، والمدفوعات السابقة"

CREATE TABLE IF NOT EXISTS payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id      UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  event_id          UUID REFERENCES events(id) ON DELETE SET NULL,  -- NULL = multi-event batch payout

  -- Financial
  gross_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,  -- إجمالي المبيعات
  platform_fees     DECIMAL(10,2) NOT NULL DEFAULT 0,  -- رسوم المنصة المخصومة
  tax_collected     DECIMAL(10,2) NOT NULL DEFAULT 0,  -- الضرائب المحصلة
  net_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,  -- المبلغ الصافي للمنظم
  currency          TEXT NOT NULL DEFAULT 'USD',

  -- Payout method snapshot
  payout_method     TEXT NOT NULL DEFAULT 'bank'
                      CHECK (payout_method IN ('bank', 'paypal', 'stripe_connect')),
  payout_destination TEXT,  -- e.g. bank account ending, PayPal email, Stripe account ID

  -- Status lifecycle
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),

  -- Scheduling: payout is held until after event ends
  eligible_at       TIMESTAMPTZ,  -- أول وقت يمكن فيه السحب (بعد انتهاء الحدث)
  requested_at      TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,

  -- Admin tracking
  processed_by      UUID REFERENCES profiles(id),
  failure_reason    TEXT,
  external_ref      TEXT,  -- Stripe transfer ID, bank reference, etc.
  notes             TEXT,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payouts_organizer ON payouts(organizer_id);
CREATE INDEX IF NOT EXISTS idx_payouts_event ON payouts(event_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_eligible ON payouts(eligible_at) WHERE status = 'pending';

-- Auto-update updated_at
CREATE TRIGGER payouts_updated_at BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════ ROW LEVEL SECURITY ════════════

ALTER TABLE organizers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- ──── ORGANIZERS RLS ────

-- Organizers can see their own record
CREATE POLICY "organizers_select_own" ON organizers FOR SELECT
  USING (user_id = auth.uid());

-- Organizers can insert their own record
CREATE POLICY "organizers_insert_own" ON organizers FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Organizers can update their own record
CREATE POLICY "organizers_update_own" ON organizers FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin can see all organizers
CREATE POLICY "organizers_select_admin" ON organizers FOR SELECT
  USING (is_admin());

-- Admin can update any organizer (verification, commission override)
CREATE POLICY "organizers_update_admin" ON organizers FOR UPDATE
  USING (is_admin());

-- ──── PAYMENTS RLS ────

-- Buyer can see payments for their own orders
CREATE POLICY "payments_select_buyer" ON payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = payments.order_id AND o.user_id = auth.uid()
    )
  );

-- Organizer can see payments for their events
CREATE POLICY "payments_select_organizer" ON payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = payments.event_id AND e.organizer_id = auth.uid()
    )
  );

-- Admin can see all payments
CREATE POLICY "payments_select_admin" ON payments FOR SELECT
  USING (is_admin());

-- No INSERT/UPDATE/DELETE for authenticated users
-- Payments are created/updated ONLY by webhook (service_role)

-- ──── PAYOUTS RLS ────

-- Organizer can see their own payouts
CREATE POLICY "payouts_select_organizer" ON payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organizers org
      WHERE org.id = payouts.organizer_id AND org.user_id = auth.uid()
    )
  );

-- Admin can see all payouts
CREATE POLICY "payouts_select_admin" ON payouts FOR SELECT
  USING (is_admin());

-- Admin can update payouts (process/approve)
CREATE POLICY "payouts_update_admin" ON payouts FOR UPDATE
  USING (is_admin());

-- No direct INSERT from authenticated — payouts created via RPC or admin


-- ════════════ GRANTS ════════════

-- organizers: organizers read/write own, admin manages all
GRANT SELECT, INSERT, UPDATE ON organizers TO authenticated;

-- payments: read-only for authenticated (created by service_role webhook)
GRANT SELECT ON payments TO authenticated;

-- payouts: read-only for organizers, admin can update
GRANT SELECT, UPDATE ON payouts TO authenticated;
-- INSERT on payouts: only via service_role or admin RPC
GRANT INSERT ON payouts TO authenticated;

-- Sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ════════════ ✅ MIGRATION v19 TASK 1 COMPLETE ════════════
--
-- Verification queries:
--
--   -- Check tables created:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('organizers', 'payments', 'payouts');
--   -- Expected: 3 rows
--
--   -- Check organizers columns:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'organizers' ORDER BY ordinal_position;
--
--   -- Check RLS enabled:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE tablename IN ('organizers', 'payments', 'payouts');
--
--   -- Check policies:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('organizers', 'payments', 'payouts')
--   ORDER BY tablename, policyname;
