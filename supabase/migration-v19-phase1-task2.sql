-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v19 Phase 1 Task 2
-- Creates: scans, refunds, audit_logs
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Purely additive. Does NOT drop or modify
-- any existing tables, columns, or data.
--
-- BRD Alignment:
--   • Section 11: سجل مسح QR والدخول والخروج
--   • Section 15: المدفوعات والاسترجاع
--   • Section 17: تسجيل Logs لكل العمليات الحساسة
--   • Section 18: Scans, Refunds, AuditLogs tables
-- ═══════════════════════════════════════════════════════════════


-- ════════════ TABLE 1: SCANS ════════════
-- BRD Section 11: "تسجيل كل عملية مسح: الوقت، المستخدم الذي مسح،
-- الجهاز، حالة التذكرة، وعدد مرات الاستخدام المتبقية"
-- "دعم إعادة الدخول للحفلات الطويلة"
-- Each row = one scan attempt (successful or not).

CREATE TABLE IF NOT EXISTS scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scanned_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Scan result
  scan_result     TEXT NOT NULL DEFAULT 'valid'
                    CHECK (scan_result IN (
                      'valid',           -- مسح ناجح — دخول
                      'exit',            -- خروج (re-entry tracking)
                      'already_used',    -- التذكرة مستخدمة بالكامل
                      'invalid',         -- QR غير صالح أو مزور
                      'cancelled',       -- التذكرة ملغاة
                      'expired',         -- الحدث انتهى
                      'wrong_event'      -- التذكرة لحدث آخر
                    )),

  -- Direction tracking for re-entry support
  direction       TEXT DEFAULT 'in'
                    CHECK (direction IN ('in', 'out')),

  -- Remaining scans after this scan
  remaining_scans INT,

  -- Device/context info
  device_info     TEXT,       -- User-Agent or device identifier
  ip_address      TEXT,
  location_note   TEXT,       -- e.g. "Gate A", "Main Entrance"

  -- Timestamps
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scans_ticket ON scans(ticket_id);
CREATE INDEX IF NOT EXISTS idx_scans_event ON scans(event_id);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_by ON scans(scanned_by);
CREATE INDEX IF NOT EXISTS idx_scans_time ON scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_result ON scans(event_id, scan_result);


-- ════════════ TABLE 2: REFUNDS ════════════
-- BRD Section 15: "دعم الاسترجاع الكامل أو الجزئي حسب سياسة الحدث"
-- "عند الاسترجاع، يتم إلغاء التذكرة وQR تلقائياً"
-- "إرسال إشعارات للمشتري والمنظم عند الاسترجاع"

CREATE TABLE IF NOT EXISTS refunds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id        UUID REFERENCES payments(id) ON DELETE SET NULL,
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Refund type
  refund_type       TEXT NOT NULL DEFAULT 'full'
                      CHECK (refund_type IN ('full', 'partial')),

  -- Amounts
  refund_amount     DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'USD',

  -- What gets refunded back
  ticket_price_refund   DECIMAL(10,2) DEFAULT 0,
  tax_refund            DECIMAL(10,2) DEFAULT 0,
  platform_fee_refund   DECIMAL(10,2) DEFAULT 0,

  -- Reason
  reason            TEXT NOT NULL,
  reason_category   TEXT DEFAULT 'customer_request'
                      CHECK (reason_category IN (
                        'customer_request',
                        'event_cancelled',
                        'event_postponed',
                        'duplicate_charge',
                        'fraud',
                        'organizer_request',
                        'admin_decision',
                        'other'
                      )),

  -- Status
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'processed', 'rejected', 'failed')),

  -- Stripe reference
  stripe_refund_id  TEXT,

  -- Tickets affected (array of ticket IDs that were cancelled)
  affected_tickets  JSONB DEFAULT '[]'::jsonb,

  -- Processing
  requested_by      UUID REFERENCES profiles(id),  -- buyer, organizer, or admin
  processed_by      UUID REFERENCES profiles(id),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  rejected_reason   TEXT,

  -- Notifications sent
  buyer_notified    BOOLEAN DEFAULT false,
  organizer_notified BOOLEAN DEFAULT false,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_event ON refunds(event_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id);

-- Auto-update updated_at
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════ TABLE 3: AUDIT_LOGS ════════════
-- BRD Section 17: "تسجيل Logs لكل العمليات الحساسة:
-- إنشاء حدث، تعديل سعر، نشر، استرجاع، سحب، مسح تذكرة"
-- "منع تعديل بيانات مهمة بعد بدء البيع إلا بصلاحية خاصة أو مع إشعار"
-- This is an append-only immutable log.

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role      TEXT,            -- role snapshot at time of action
  actor_email     TEXT,            -- email snapshot for traceability

  -- What happened
  action          TEXT NOT NULL,   -- e.g. 'event.created', 'ticket.price_changed', 'payout.processed'
  entity_type     TEXT NOT NULL,   -- e.g. 'event', 'order', 'ticket', 'payout', 'user'
  entity_id       UUID,            -- ID of the affected entity

  -- Details
  description     TEXT,            -- Human-readable summary
  old_value       JSONB,           -- Previous state (for change tracking)
  new_value       JSONB,           -- New state
  metadata        JSONB,           -- Additional context (IP, device, etc.)

  -- Context
  ip_address      TEXT,
  user_agent      TEXT,

  -- Timestamp (immutable — no updated_at on purpose)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for querying audit trail
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);


-- ════════════ ROW LEVEL SECURITY ════════════

ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ──── SCANS RLS ────

-- Organizer can see scans for their own events
CREATE POLICY "scans_select_organizer" ON scans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = scans.event_id AND e.organizer_id = auth.uid()
    )
  );

-- Scanner can see scans they performed
CREATE POLICY "scans_select_own" ON scans FOR SELECT
  USING (scanned_by = auth.uid());

-- Admin can see all scans
CREATE POLICY "scans_select_admin" ON scans FOR SELECT
  USING (is_admin());

-- No direct INSERT from client — scans created via verify-ticket Edge Function (service_role)

-- ──── REFUNDS RLS ────

-- Buyer can see refunds for their own orders
CREATE POLICY "refunds_select_buyer" ON refunds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = refunds.order_id AND o.user_id = auth.uid()
    )
  );

-- Organizer can see refunds for their events
CREATE POLICY "refunds_select_organizer" ON refunds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = refunds.event_id AND e.organizer_id = auth.uid()
    )
  );

-- Admin can see all refunds
CREATE POLICY "refunds_select_admin" ON refunds FOR SELECT
  USING (is_admin());

-- Admin can update refunds (approve/reject)
CREATE POLICY "refunds_update_admin" ON refunds FOR UPDATE
  USING (is_admin());

-- Buyers can request refunds (INSERT)
CREATE POLICY "refunds_insert_buyer" ON refunds FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = refunds.order_id AND o.user_id = auth.uid()
    )
  );

-- ──── AUDIT_LOGS RLS ────
-- Only admin can read audit logs. No one can modify or delete them.

CREATE POLICY "audit_logs_select_admin" ON audit_logs FOR SELECT
  USING (is_admin());

-- INSERT: only service_role or admin RPCs can write.
-- No direct INSERT policy for authenticated users — prevents log tampering.


-- ════════════ GRANTS ════════════

-- scans: read-only for authenticated (created by service_role)
GRANT SELECT ON scans TO authenticated;

-- refunds: read + insert for authenticated, update via admin
GRANT SELECT, INSERT ON refunds TO authenticated;
GRANT UPDATE ON refunds TO authenticated;

-- audit_logs: read-only for admin (RLS enforces), insert for service_role
GRANT SELECT ON audit_logs TO authenticated;
-- INSERT not granted to authenticated — only service_role can write

-- Sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ════════════ ✅ MIGRATION v19 TASK 2 COMPLETE ════════════
--
-- Verification queries:
--
--   -- Check tables created:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('scans', 'refunds', 'audit_logs');
--   -- Expected: 3 rows
--
--   -- Check scans columns:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'scans' ORDER BY ordinal_position;
--
--   -- Check RLS policies:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('scans', 'refunds', 'audit_logs')
--   ORDER BY tablename, policyname;
