-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v23 Phase 6 Task 1
-- Notification System: Email Templates + Email Logs
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates new tables. Idempotent.
--
-- BRD Section 16:
--   "يجب أن يكون للنظام قوالب بريد قابلة للتعديل من لوحة الأدمن"
--   "يجب تسجيل كل بريد مرسل لمنع التكرار"
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: email_templates ════════════
-- Stores editable HTML email templates with variable placeholders.
-- Admin can edit these from the dashboard.

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template identifier (unique, used in code to look up templates)
  name TEXT NOT NULL UNIQUE,

  -- Display label for admin UI
  label TEXT NOT NULL,

  -- Email subject line (supports {{variables}})
  subject TEXT NOT NULL,

  -- Full HTML body (supports {{variables}})
  body_html TEXT NOT NULL,

  -- Comma-separated list of available variables for this template
  -- Displayed to admin as a helper when editing
  available_variables TEXT NOT NULL DEFAULT '',

  -- Template category for admin UI grouping
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('organizer', 'buyer', 'admin', 'reminder', 'general')),

  -- Is this template active? Disabled templates won't be sent.
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_email_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_template_updated ON email_templates;
CREATE TRIGGER trg_email_template_updated
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_email_template_timestamp();


-- ════════════ STEP 2: Default Templates ════════════
-- Seed with production-ready templates.
-- ON CONFLICT ensures idempotent re-runs.

INSERT INTO email_templates (name, label, subject, body_html, available_variables, category)
VALUES

-- ── 1. Event Approved (to Organizer) ──
(
  'event_approved',
  'Event Approved',
  '✅ Your event "{{event_title}}" has been approved!',
  '<!DOCTYPE html><html><body style="font-family:''Inter'',system-ui,sans-serif;background:#f8f8f8;padding:32px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#191922,#2d2d3f);padding:32px;text-align:center;">
    <h1 style="color:#a78bfa;margin:0;font-size:24px;">Event Approved! 🎉</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#333;font-size:16px;">Hi <strong>{{organizer_name}}</strong>,</p>
    <p style="color:#555;font-size:15px;">Great news! Your event <strong>"{{event_title}}"</strong> has been reviewed and approved by our team.</p>
    <p style="color:#555;font-size:15px;">It is now live and visible to the public. Buyers can start purchasing tickets immediately.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:24px 0;">
      <p style="margin:0;color:#166534;font-size:14px;">📅 <strong>Date:</strong> {{event_date}}</p>
      <p style="margin:8px 0 0;color:#166534;font-size:14px;">📍 <strong>Venue:</strong> {{event_venue}}</p>
    </div>
    <a href="{{dashboard_url}}" style="display:inline-block;background:#a78bfa;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">View Dashboard</a>
  </div>
  <div style="padding:16px 32px;background:#f9f9f9;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">Eventsli — Event Management Platform</p>
  </div>
</div>
</body></html>',
  'organizer_name, event_title, event_date, event_venue, dashboard_url',
  'organizer'
),

-- ── 2. Event Rejected (to Organizer) ──
(
  'event_rejected',
  'Event Rejected',
  '⚠️ Your event "{{event_title}}" needs changes',
  '<!DOCTYPE html><html><body style="font-family:''Inter'',system-ui,sans-serif;background:#f8f8f8;padding:32px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#191922,#2d2d3f);padding:32px;text-align:center;">
    <h1 style="color:#f87171;margin:0;font-size:24px;">Event Review Update</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#333;font-size:16px;">Hi <strong>{{organizer_name}}</strong>,</p>
    <p style="color:#555;font-size:15px;">We have reviewed your event <strong>"{{event_title}}"</strong> and it requires some changes before it can be published.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin:24px 0;">
      <p style="margin:0;color:#991b1b;font-size:14px;font-weight:600;">Reason:</p>
      <p style="margin:8px 0 0;color:#b91c1c;font-size:14px;">{{rejection_reason}}</p>
    </div>
    <p style="color:#555;font-size:15px;">Please update your event and resubmit for review.</p>
    <a href="{{dashboard_url}}" style="display:inline-block;background:#a78bfa;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">Edit Event</a>
  </div>
  <div style="padding:16px 32px;background:#f9f9f9;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">Eventsli — Event Management Platform</p>
  </div>
</div>
</body></html>',
  'organizer_name, event_title, rejection_reason, dashboard_url',
  'organizer'
),

-- ── 3. Event Changed (to Buyers) ──
(
  'event_changed',
  'Event Details Changed',
  '📢 Update: "{{event_title}}" — date or venue changed',
  '<!DOCTYPE html><html><body style="font-family:''Inter'',system-ui,sans-serif;background:#f8f8f8;padding:32px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#191922,#2d2d3f);padding:32px;text-align:center;">
    <h1 style="color:#fbbf24;margin:0;font-size:24px;">Event Update 📢</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#333;font-size:16px;">Hi <strong>{{buyer_name}}</strong>,</p>
    <p style="color:#555;font-size:15px;">The organizer has made changes to <strong>"{{event_title}}"</strong> for which you have tickets.</p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;margin:24px 0;">
      <p style="margin:0;color:#92400e;font-size:14px;">{{change_details}}</p>
    </div>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px;margin:24px 0;">
      <p style="margin:0;color:#0c4a6e;font-size:14px;">📅 <strong>New Date:</strong> {{event_date}}</p>
      <p style="margin:8px 0 0;color:#0c4a6e;font-size:14px;">📍 <strong>New Venue:</strong> {{event_venue}}</p>
    </div>
    <a href="{{ticket_link}}" style="display:inline-block;background:#a78bfa;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">View My Tickets</a>
  </div>
  <div style="padding:16px 32px;background:#f9f9f9;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">Eventsli — Event Management Platform</p>
  </div>
</div>
</body></html>',
  'buyer_name, event_title, change_details, event_date, event_venue, ticket_link',
  'buyer'
),

-- ── 4. Event Reminder (to Buyers, 24h before) ──
(
  'event_reminder',
  'Event Reminder (24h)',
  '⏰ Reminder: "{{event_title}}" is tomorrow!',
  '<!DOCTYPE html><html><body style="font-family:''Inter'',system-ui,sans-serif;background:#f8f8f8;padding:32px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#191922,#2d2d3f);padding:32px;text-align:center;">
    <h1 style="color:#22c55e;margin:0;font-size:24px;">See You Tomorrow! 🎶</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#333;font-size:16px;">Hi <strong>{{buyer_name}}</strong>,</p>
    <p style="color:#555;font-size:15px;">This is a friendly reminder that <strong>"{{event_title}}"</strong> is happening tomorrow!</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:24px 0;">
      <p style="margin:0;color:#166534;font-size:14px;">📅 <strong>Date:</strong> {{event_date}}</p>
      <p style="margin:8px 0 0;color:#166534;font-size:14px;">📍 <strong>Venue:</strong> {{event_venue}}</p>
      <p style="margin:8px 0 0;color:#166534;font-size:14px;">🎫 <strong>Ticket:</strong> {{tier_name}}</p>
    </div>
    <p style="color:#555;font-size:15px;">Make sure to have your ticket QR code ready at the entrance. You can download your PDF ticket from your account.</p>
    <a href="{{ticket_link}}" style="display:inline-block;background:#a78bfa;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">View My Tickets</a>
  </div>
  <div style="padding:16px 32px;background:#f9f9f9;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">Eventsli — Event Management Platform</p>
  </div>
</div>
</body></html>',
  'buyer_name, event_title, event_date, event_venue, tier_name, ticket_link',
  'reminder'
),

-- ── 5. Event Created (to Organizer - confirmation) ──
(
  'event_created',
  'Event Submitted for Review',
  '📝 Your event "{{event_title}}" is under review',
  '<!DOCTYPE html><html><body style="font-family:''Inter'',system-ui,sans-serif;background:#f8f8f8;padding:32px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#191922,#2d2d3f);padding:32px;text-align:center;">
    <h1 style="color:#a78bfa;margin:0;font-size:24px;">Event Submitted 📝</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#333;font-size:16px;">Hi <strong>{{organizer_name}}</strong>,</p>
    <p style="color:#555;font-size:15px;">Your event <strong>"{{event_title}}"</strong> has been submitted and is currently under review by our team.</p>
    <p style="color:#555;font-size:15px;">You will receive an email once it has been approved or if any changes are needed. This usually takes less than 24 hours.</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin:24px 0;">
      <p style="margin:0;color:#1e40af;font-size:14px;">📅 <strong>Date:</strong> {{event_date}}</p>
      <p style="margin:8px 0 0;color:#1e40af;font-size:14px;">📍 <strong>Venue:</strong> {{event_venue}}</p>
    </div>
  </div>
  <div style="padding:16px 32px;background:#f9f9f9;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">Eventsli — Event Management Platform</p>
  </div>
</div>
</body></html>',
  'organizer_name, event_title, event_date, event_venue',
  'organizer'
)

ON CONFLICT (name) DO NOTHING;  -- Idempotent: don't overwrite admin edits


-- ════════════ STEP 3: email_logs ════════════
-- Records every sent email for deduplication and auditing.
-- Used by reminder cron to prevent duplicate sends.

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which template was used
  template_name TEXT NOT NULL,

  -- Recipient
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,

  -- Context: which entity triggered this email
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,

  -- Email content snapshot (for audit)
  subject_rendered TEXT,

  -- Delivery status
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed', 'bounced', 'queued')),
  error_message TEXT,

  -- Brevo message ID (for tracking)
  provider_message_id TEXT,

  -- Timestamp
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for deduplication queries (e.g., "was reminder already sent for this event+email?")
CREATE INDEX IF NOT EXISTS idx_email_logs_dedup
  ON email_logs (template_name, event_id, recipient_email);

-- Index for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at
  ON email_logs (sent_at DESC);

-- Index for per-event email history
CREATE INDEX IF NOT EXISTS idx_email_logs_event_id
  ON email_logs (event_id) WHERE event_id IS NOT NULL;


-- ════════════ STEP 4: RLS Policies ════════════

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Templates: only admin can read/write
DROP POLICY IF EXISTS email_templates_admin_all ON email_templates;
CREATE POLICY email_templates_admin_all ON email_templates
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Logs: only admin can read
DROP POLICY IF EXISTS email_logs_admin_read ON email_logs;
CREATE POLICY email_logs_admin_read ON email_logs
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Service role can insert logs (from Edge Functions)
-- No policy needed — service role bypasses RLS.


-- ════════════ ✅ MIGRATION v23 TASK 1 COMPLETE ════════════
--
-- Tables created:
--   ✓ email_templates — 5 default templates seeded
--   ✓ email_logs — with dedup + audit indexes
--
-- RLS:
--   ✓ email_templates — admin only
--   ✓ email_logs — admin read only (Edge Functions write via service role)
--
-- Verification:
--   SELECT name, label, category, is_active FROM email_templates;
--   SELECT COUNT(*) FROM email_logs;
