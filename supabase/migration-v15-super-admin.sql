-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Super Admin Migration v15
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Does NOT drop tables or data.
-- Adds the Super Admin infrastructure:
--   • platform_settings CMS table + seed data
--   • Event approval pipeline columns + RLS
--   • Admin global-access RLS policies
--   • Approval/rejection RPCs
--   • Backfill for existing published events
--   • Superadmin role designation
-- ═══════════════════════════════════════════════════════════════


-- ════════════ PHASE 0: Admin Helper Function ════════════
-- SECURITY DEFINER runs as the function owner (postgres superuser),
-- bypassing RLS. This prevents infinite recursion when admin
-- policies on the profiles table query the profiles table itself.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, anon;


-- ════════════ PHASE 1: Platform Settings Table ════════════

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES profiles(id)
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Trigger to auto-update updated_at
CREATE TRIGGER platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════ PHASE 2: Seed CMS Data ════════════
-- Captures the exact current content of index.html so the
-- landing page can be dynamically edited by the Super Admin.

INSERT INTO platform_settings (key, value) VALUES
(
  'hero',
  '{
    "heading_line1": "Discover & Create Events",
    "heading_highlight": "Effortlessly",
    "description": "With Event Waw, You Can Book Tickets For Concerts, Festivals, Exhibitions, Sports, And Conferences In Just A Few Clicks. For Organizers, Our All-in-One Platform Makes Managing Ticketing, Sponsors, Vendors, And Marketing Simple.",
    "image_url": "images/hero-event-poster.png",
    "cta_primary_text": "Create Your Event",
    "cta_primary_url": "/register.html",
    "cta_secondary_text": "Explore Events",
    "cta_secondary_url": "/events.html"
  }'::jsonb
),
(
  'stats_bar',
  '[
    {"value": "+50",    "label": "Successful Events", "icon": "calendar"},
    {"value": "+5,000", "label": "Attendees",          "icon": "users"},
    {"value": "2026",   "label": "Founded in",         "icon": "layers"}
  ]'::jsonb
),
(
  'sponsors',
  '[
    {"name": "World Trade Centre",              "logo_url": "images/sponsor-worldtrade.png"},
    {"name": "EDGE",                            "logo_url": "images/sponsor-edge.png"},
    {"name": "Cafe",                            "logo_url": "images/sponsor-cafe.png"},
    {"name": "FEO Festivals & Events Ontario",  "logo_url": "images/sponsor-feo.png"},
    {"name": "City of Toronto",                 "logo_url": "images/sponsor-toronto.png"},
    {"name": "University of Toronto Mississauga","logo_url": "images/sponsor-university.png"},
    {"name": "Brampton Flower City",            "logo_url": "images/sponsor-brampton.png"}
  ]'::jsonb
),
(
  'trusted_partners',
  '[
    {"name": "Visa",             "icon_id": "visa"},
    {"name": "Mastercard",       "icon_id": "mastercard"},
    {"name": "Google",           "icon_id": "google"},
    {"name": "Stripe",           "icon_id": "stripe"},
    {"name": "PayPal",           "icon_id": "paypal"},
    {"name": "American Express", "icon_id": "amex"},
    {"name": "Vercel",           "icon_id": "vercel"}
  ]'::jsonb
)
ON CONFLICT (key) DO NOTHING;


-- ════════════ PHASE 3: Events Table — Approval Pipeline Columns ════════════

-- The approval gate — orthogonal to the organizer's draft/published status
ALTER TABLE events ADD COLUMN IF NOT EXISTS admin_approved BOOLEAN DEFAULT false;

-- Rejection feedback — shown to organizer so they can fix and re-publish
ALTER TABLE events ADD COLUMN IF NOT EXISTS admin_rejected_reason TEXT;

-- Audit trail
ALTER TABLE events ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS admin_reviewed_by UUID REFERENCES profiles(id);

-- Performance index for the approval queue
CREATE INDEX IF NOT EXISTS idx_events_approval_queue
  ON events(admin_approved, status) WHERE status = 'published';


-- ════════════ PHASE 4: RLS — Rewrite Public Event Visibility ════════════
-- CRITICAL: Public users must only see published AND admin-approved events.
-- The organizer's own-event policy (events_select_own) is untouched.

-- 4a. Replace the public SELECT policy
DROP POLICY IF EXISTS "events_select_published" ON events;

CREATE POLICY "events_select_public" ON events FOR SELECT
  USING (
    status = 'published'
    AND admin_approved = true
  );

-- 4b. Harden the INSERT policy — organizers cannot self-approve
DROP POLICY IF EXISTS "events_insert" ON events;

CREATE POLICY "events_insert" ON events FOR INSERT
  WITH CHECK (
    organizer_id = auth.uid()
    AND (admin_approved IS NULL OR admin_approved = false)
  );

-- 4c. Harden the organizer UPDATE policy — cannot flip admin_approved
DROP POLICY IF EXISTS "events_update_own" ON events;

CREATE POLICY "events_update_own" ON events FOR UPDATE
  USING (organizer_id = auth.uid())
  WITH CHECK (
    organizer_id = auth.uid()
    AND admin_approved IS NOT DISTINCT FROM (
      SELECT e.admin_approved FROM events e WHERE e.id = events.id
    )
  );

-- 4d. Update ticket_tiers public visibility (defense in depth)
DROP POLICY IF EXISTS "tiers_select_published" ON ticket_tiers;

CREATE POLICY "tiers_select_published" ON ticket_tiers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
        AND e.status = 'published'
        AND e.admin_approved = true
    )
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = ticket_tiers.event_id
          AND e.organizer_id = auth.uid()
      )
    )
  );


-- ════════════ PHASE 5: RLS — Admin Global Access Policies ════════════
-- These let the admin read/manage all data across the platform.

-- 5a. Profiles — admin can see all users
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
  USING (is_admin());

-- 5b. Events — admin can see all events (any status)
CREATE POLICY "events_select_admin" ON events FOR SELECT
  USING (is_admin());

-- 5c. Events — admin can update any event (approve/reject/edit)
CREATE POLICY "events_update_admin" ON events FOR UPDATE
  USING (is_admin());

-- 5d. Orders — admin can see all orders (financial oversight)
CREATE POLICY "orders_select_admin" ON orders FOR SELECT
  USING (is_admin());

-- 5e. Tickets — admin can see all tickets
CREATE POLICY "tickets_select_admin" ON tickets FOR SELECT
  USING (is_admin());

-- 5f. Ticket tiers — admin can see all tiers
CREATE POLICY "tiers_select_admin" ON ticket_tiers FOR SELECT
  USING (is_admin());


-- ════════════ PHASE 6: RLS — Platform Settings ════════════

-- Anyone can READ settings (landing page fetches these)
CREATE POLICY "settings_select_public" ON platform_settings FOR SELECT
  USING (true);

-- Only admins can INSERT new settings
CREATE POLICY "settings_insert_admin" ON platform_settings FOR INSERT
  WITH CHECK (is_admin());

-- Only admins can UPDATE settings
CREATE POLICY "settings_update_admin" ON platform_settings FOR UPDATE
  USING (is_admin());

-- Only admins can DELETE settings
CREATE POLICY "settings_delete_admin" ON platform_settings FOR DELETE
  USING (is_admin());


-- ════════════ PHASE 7: Approval RPCs ════════════
-- SECURITY DEFINER RPCs for the approval pipeline.
-- Internal admin check prevents non-admin callers.

CREATE OR REPLACE FUNCTION admin_approve_event(p_event_id UUID)
RETURNS void AS $func$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE events SET
    admin_approved = true,
    admin_rejected_reason = NULL,
    admin_reviewed_at = NOW(),
    admin_reviewed_by = auth.uid()
  WHERE id = p_event_id
    AND status = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found or not in published status';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_reject_event(p_event_id UUID, p_reason TEXT)
RETURNS void AS $func$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE events SET
    admin_approved = false,
    status = 'draft',
    admin_rejected_reason = trim(p_reason),
    admin_reviewed_at = NOW(),
    admin_reviewed_by = auth.uid()
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Platform analytics RPC — returns global stats for admin dashboard
CREATE OR REPLACE FUNCTION admin_get_platform_stats()
RETURNS TABLE(
  total_users       BIGINT,
  total_organizers   BIGINT,
  total_events       BIGINT,
  published_events   BIGINT,
  pending_approval   BIGINT,
  total_orders       BIGINT,
  total_tickets      BIGINT,
  total_revenue      NUMERIC
) AS $func$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM profiles)::BIGINT,
    (SELECT COUNT(*) FROM profiles WHERE role = 'organizer')::BIGINT,
    (SELECT COUNT(*) FROM events)::BIGINT,
    (SELECT COUNT(*) FROM events WHERE status = 'published' AND admin_approved = true)::BIGINT,
    (SELECT COUNT(*) FROM events WHERE status = 'published' AND admin_approved = false)::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE status = 'paid')::BIGINT,
    (SELECT COUNT(*) FROM tickets WHERE status IN ('valid', 'scanned'))::BIGINT,
    COALESCE((SELECT SUM(amount) FROM orders WHERE status = 'paid'), 0);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════ PHASE 8: Grants ════════════

-- Platform settings: public read, authenticated write (RLS gates to admin)
GRANT SELECT ON platform_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON platform_settings TO authenticated;

-- RPCs: only authenticated can call (internal admin check enforces)
GRANT EXECUTE ON FUNCTION admin_approve_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_event(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_platform_stats() TO authenticated;


-- ════════════ PHASE 9: Critical Backfill ════════════
-- Auto-approve ALL currently published events so they remain
-- visible on the public landing/events pages after the new
-- RLS policy takes effect. Without this, all events vanish.

UPDATE events
SET admin_approved = true,
    admin_reviewed_at = NOW()
WHERE status = 'published'
  AND (admin_approved IS NULL OR admin_approved = false);


-- ════════════ PHASE 10: Storage Bucket for Platform Assets ════════════
-- Used by the CMS editor for hero images, sponsor logos, etc.

INSERT INTO storage.buckets (id, name, public)
VALUES ('platform-assets', 'platform-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for platform-assets bucket
DROP POLICY IF EXISTS "platform_assets_select" ON storage.objects;
DROP POLICY IF EXISTS "platform_assets_insert" ON storage.objects;
DROP POLICY IF EXISTS "platform_assets_update" ON storage.objects;
DROP POLICY IF EXISTS "platform_assets_delete" ON storage.objects;

CREATE POLICY "platform_assets_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'platform-assets');

CREATE POLICY "platform_assets_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'platform-assets' AND is_admin());

CREATE POLICY "platform_assets_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'platform-assets' AND is_admin());

CREATE POLICY "platform_assets_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'platform-assets' AND is_admin());


-- ════════════ PHASE 11: Superadmin Designation ════════════
-- Sets the specified user as the platform superadmin.
-- The profiles_update_own policy prevents self-promotion,
-- so this must be run from the SQL Editor (service_role context).

UPDATE profiles
SET role = 'admin'
WHERE email = 'gooamr88@gmail.com';


-- ════════════ ✅ MIGRATION COMPLETE ════════════
--
-- Verification queries:
--
--   -- Check platform_settings seeded:
--   SELECT key, jsonb_pretty(value) FROM platform_settings;
--
--   -- Check admin_approved column exists:
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'events' AND column_name LIKE 'admin_%';
--
--   -- Check backfill worked (all published events are approved):
--   SELECT id, title, status, admin_approved FROM events WHERE status = 'published';
--
--   -- Check superadmin role:
--   SELECT id, email, role FROM profiles WHERE email = 'gooamr88@gmail.com';
--
--   -- Check new policies exist:
--   SELECT polname, polcmd FROM pg_policies
--   WHERE tablename IN ('events', 'profiles', 'orders', 'tickets', 'platform_settings')
--   AND polname LIKE '%admin%' OR polname = 'events_select_public'
--   ORDER BY tablename, polname;
--
--   -- Test is_admin() function:
--   SELECT is_admin();  -- Should return false for non-admin callers
--
-- What changed:
--   ✓ platform_settings table created with CMS seed data
--   ✓ events.admin_approved + audit columns added
--   ✓ Public event visibility now requires admin_approved = true
--   ✓ Organizer INSERT/UPDATE hardened against self-approval
--   ✓ Ticket tier visibility updated for approval pipeline
--   ✓ Admin can SELECT all profiles, events, orders, tickets
--   ✓ Admin can UPDATE any event (approve/reject)
--   ✓ admin_approve_event() and admin_reject_event() RPCs created
--   ✓ admin_get_platform_stats() RPC created
--   ✓ Existing published events backfilled as approved
--   ✓ platform-assets storage bucket created (admin-only writes)
--   ✓ gooamr88@gmail.com designated as superadmin
