-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Priority 1 Database Patch
-- Missing tables: vendor_requests, promo_codes
-- Missing RPCs: request_organizer_upgrade, get_order_by_session
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════


-- ════════════ VENDOR REQUESTS TABLE ════════════

CREATE TABLE IF NOT EXISTS vendor_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  category TEXT DEFAULT 'general',
  description TEXT,
  booth_size TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_requests_event ON vendor_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_vendor_requests_user ON vendor_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_vendor_requests_status ON vendor_requests(status);

-- Trigger for updated_at
CREATE TRIGGER vendor_requests_updated_at BEFORE UPDATE ON vendor_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE vendor_requests ENABLE ROW LEVEL SECURITY;

-- Organizers can see requests for their events
CREATE POLICY "vendor_requests_select_organizer" ON vendor_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM events e WHERE e.id = vendor_requests.event_id AND e.organizer_id = auth.uid())
);

-- Users can see their own requests
CREATE POLICY "vendor_requests_select_own" ON vendor_requests FOR SELECT USING (
  user_id = auth.uid()
);

-- Authenticated users can submit requests
CREATE POLICY "vendor_requests_insert" ON vendor_requests FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

-- Organizers can update (approve/reject) requests for their events
CREATE POLICY "vendor_requests_update_organizer" ON vendor_requests FOR UPDATE USING (
  EXISTS (SELECT 1 FROM events e WHERE e.id = vendor_requests.event_id AND e.organizer_id = auth.uid())
);

-- Grants
GRANT SELECT, INSERT ON vendor_requests TO authenticated;
GRANT UPDATE ON vendor_requests TO authenticated;


-- ════════════ PROMO CODES TABLE ════════════

CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organizer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  max_uses INT DEFAULT 100,
  used_count INT DEFAULT 0,
  min_order_amount DECIMAL(10,2) DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, code)
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_event ON promo_codes(event_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_organizer ON promo_codes(organizer_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

-- Trigger for updated_at
CREATE TRIGGER promo_codes_updated_at BEFORE UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- Organizers can manage promo codes for their own events
CREATE POLICY "promo_codes_select_organizer" ON promo_codes FOR SELECT USING (
  organizer_id = auth.uid()
  OR EXISTS (SELECT 1 FROM events e WHERE e.id = promo_codes.event_id AND e.organizer_id = auth.uid())
);

CREATE POLICY "promo_codes_insert" ON promo_codes FOR INSERT WITH CHECK (
  organizer_id = auth.uid()
  AND EXISTS (SELECT 1 FROM events e WHERE e.id = promo_codes.event_id AND e.organizer_id = auth.uid())
);

CREATE POLICY "promo_codes_update_organizer" ON promo_codes FOR UPDATE USING (
  organizer_id = auth.uid()
);

CREATE POLICY "promo_codes_delete_organizer" ON promo_codes FOR DELETE USING (
  organizer_id = auth.uid()
);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON promo_codes TO authenticated;


-- ════════════ REQUEST ORGANIZER UPGRADE RPC ════════════

-- Safely upgrades an attendee to organizer role.
-- Only attendees can upgrade. Organizers/admins are rejected (silently returns true).
CREATE OR REPLACE FUNCTION request_organizer_upgrade()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_current_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role::TEXT INTO v_current_role
  FROM profiles
  WHERE id = v_user_id;

  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Already organizer or admin — no-op
  IF v_current_role IN ('organizer', 'admin') THEN
    RETURN;
  END IF;

  -- Only attendees can upgrade
  IF v_current_role != 'attendee' THEN
    RAISE EXCEPTION 'Only attendees can upgrade to organizer';
  END IF;

  UPDATE profiles
  SET role = 'organizer'
  WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION request_organizer_upgrade() TO authenticated;


-- ════════════ GET ORDER BY SESSION RPC ════════════

-- Retrieves order details by Stripe session ID.
-- Only returns the order if it belongs to the requesting user,
-- OR the user is the event organizer.
CREATE OR REPLACE FUNCTION get_order_by_session(p_session_id TEXT)
RETURNS TABLE(
  order_id UUID,
  event_id UUID,
  event_title TEXT,
  amount DECIMAL,
  currency TEXT,
  status TEXT,
  tickets JSONB,
  created_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  RETURN QUERY
  SELECT
    o.id AS order_id,
    o.event_id,
    e.title::TEXT AS event_title,
    o.amount,
    o.currency::TEXT,
    o.status::TEXT,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'ticket_id', t.id,
        'tier_name', tt.name,
        'qr_hash', t.qr_hash,
        'status', t.status::TEXT
      ))
      FROM tickets t
      JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
      WHERE t.order_id = o.id),
      '[]'::jsonb
    ) AS tickets,
    o.created_at
  FROM orders o
  JOIN events e ON e.id = o.event_id
  WHERE o.stripe_session_id = p_session_id
    AND (
      o.user_id = v_user_id
      OR e.organizer_id = v_user_id
      OR v_user_id IS NULL  -- Allow service_role calls
    )
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_order_by_session(TEXT) TO authenticated;


-- ════════════ ✅ PATCH COMPLETE ════════════
-- New tables: vendor_requests, promo_codes
-- New RPCs: request_organizer_upgrade(), get_order_by_session()
-- All have proper RLS + grants.
