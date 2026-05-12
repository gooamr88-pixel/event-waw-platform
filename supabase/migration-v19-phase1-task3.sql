-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v19 Phase 1 Task 3
-- Alters: orders, events tables + adds missing enum values
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Uses ADD COLUMN IF NOT EXISTS and
-- ADD VALUE IF NOT EXISTS. Fully idempotent.
--
-- BRD Alignment:
--   • Section 6:  حفظ الضرائب والرسوم داخل الطلب
--   • Section 7:  تسجيل وقت الموافقة على الشروط
--   • Section 19: حالات التذكرة والطلب والمقعد والحدث
-- ═══════════════════════════════════════════════════════════════


-- ════════════ PART A: ALTER ORDERS TABLE ════════════
-- BRD Section 6: "يجب حفظ كل الرسوم والضرائب داخل الطلب
-- حتى لا تتغير بعد الشراء حتى لو تغيرت إعدادات الحدث لاحقاً"

-- سعر التذاكر الأساسي (بدون ضريبة أو رسوم)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0;

-- مبلغ الضريبة (snapshot وقت الشراء)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0;

-- نسبة الضريبة وقت الشراء (للتوثيق)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate_snapshot DECIMAL(5,2) DEFAULT 0;

-- إجمالي عمولة المنصة المحسوبة
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_amount DECIMAL(10,2) DEFAULT 0;

-- هل السعر شامل الضريبة أم فوقه
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;

-- مرجع لجدول payments
-- (لا نضيف FK هنا لأن payments قد لا يحتوي row بعد — يُربط بعد الدفع)


-- ════════════ PART B: ALTER EVENTS TABLE ════════════
-- BRD Section 7: "يجب أن يوافق المنظم على شروط المنصة
-- وتسجيل وقت الموافقة ونسخة الشروط"

ALTER TABLE events ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS terms_version TEXT;

-- BRD Section 3: سياسات الحدث
ALTER TABLE events ADD COLUMN IF NOT EXISTS refund_policy TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS entry_policy TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS parking_info TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS security_notes TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS children_policy TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS attendee_notes TEXT;

-- BRD Section 4: هل الحدث عام أم خاص
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;

-- BRD Section 5: إخفاء/إظهار عدد التذاكر المتبقية
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_remaining_tickets BOOLEAN DEFAULT true;

-- BRD Section 11: عدد مرات المسح المسموح وسياسة إعادة الدخول
ALTER TABLE events ADD COLUMN IF NOT EXISTS reentry_allowed BOOLEAN DEFAULT false;


-- ════════════ PART C: ALTER TICKET_TIERS TABLE ════════════
-- BRD Section 5: حقول إضافية مفقودة

-- تاريخ بداية ونهاية بيع هذه الفئة
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ;
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS sale_ends_at TIMESTAMPTZ;

-- هل الفئة ظاهرة أو مخفية
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true;

-- الحد الأدنى والأعلى للشراء لكل طلب
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS min_per_order INT DEFAULT 1;
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS max_per_order INT DEFAULT 10;

-- هل التذاكر مرتبطة بمقاعد أم دخول عام
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS is_seated BOOLEAN DEFAULT false;


-- ════════════ PART D: ALTER TICKETS TABLE ════════════
-- BRD Section 11: تتبع عدد مرات المسح

-- عدد المرات التي تم فيها مسح هذه التذكرة فعلياً
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS scan_count INT DEFAULT 0;

-- الحد الأقصى المسموح (مأخوذ من ticket_tier.max_scans وقت الإصدار)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS max_scans_allowed INT DEFAULT 1;

-- رقم المقعد/الطاولة (denormalized for PDF/display)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS seat_label TEXT;


-- ════════════ PART E: MISSING ENUM VALUES ════════════
-- BRD Section 19: حالات مفقودة

-- Event Status: draft, pending_review, approved, published, paused, sold_out, completed, canceled
-- Existing: draft, published, cancelled, completed, archived
ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'sold_out';

-- Order Status: draft, pending_payment, paid, failed, canceled, refunded, partially_refunded
-- Existing: pending, paid, refunded, failed
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'canceled';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'partially_refunded';

-- Ticket Status: active, used, partially_used, canceled, refunded, expired, blocked
-- Existing: valid, scanned, cancelled
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'partially_used';
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'blocked';


-- ════════════ ✅ MIGRATION v19 TASK 3 COMPLETE ════════════
--
-- Verification queries:
--
--   -- Check new order columns:
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'orders'
--   AND column_name IN ('subtotal', 'tax_amount', 'tax_rate_snapshot',
--                       'platform_fee_amount', 'tax_inclusive')
--   ORDER BY column_name;
--   -- Expected: 5 rows
--
--   -- Check new event columns:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'events'
--   AND column_name IN ('terms_accepted_at', 'terms_version',
--                       'refund_policy', 'entry_policy', 'is_private',
--                       'show_remaining_tickets', 'reentry_allowed');
--   -- Expected: 7 rows
--
--   -- Check new ticket_tier columns:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'ticket_tiers'
--   AND column_name IN ('sale_starts_at', 'sale_ends_at', 'is_visible',
--                       'min_per_order', 'max_per_order', 'is_seated');
--   -- Expected: 6 rows
--
--   -- Check new ticket columns:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'tickets'
--   AND column_name IN ('scan_count', 'max_scans_allowed', 'seat_label');
--   -- Expected: 3 rows
--
--   -- Check enum values:
--   SELECT unnest(enum_range(NULL::event_status));
--   SELECT unnest(enum_range(NULL::order_status));
--   SELECT unnest(enum_range(NULL::ticket_status));
