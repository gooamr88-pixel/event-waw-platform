-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — MASTER DATABASE RESET
-- This script DROPS everything and rebuilds from scratch.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- ══════════════════════════════════
-- PHASE 0: NUCLEAR CLEANUP
-- Drop everything in the right order (respecting FK constraints)
-- ══════════════════════════════════

-- Drop cron jobs (ignore errors if pg_cron not enabled)
DO $$ BEGIN
  PERFORM cron.unschedule('expire-reservations');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('cleanup-otps');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Drop triggers first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS events_updated_at ON events;
DROP TRIGGER IF EXISTS orders_updated_at ON orders;

-- Drop all functions
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
DROP FUNCTION IF EXISTS create_reservation(UUID, UUID, INT) CASCADE;
DROP FUNCTION IF EXISTS get_tier_availability(UUID) CASCADE;
DROP FUNCTION IF EXISTS expire_stale_reservations() CASCADE;
DROP FUNCTION IF EXISTS increment_sold_count(UUID, INT) CASCADE;
DROP FUNCTION IF EXISTS generate_login_otp() CASCADE;
DROP FUNCTION IF EXISTS generate_login_otp_for_user(UUID) CASCADE;
DROP FUNCTION IF EXISTS verify_login_otp(TEXT) CASCADE;
DROP FUNCTION IF EXISTS cleanup_expired_otps() CASCADE;
DROP FUNCTION IF EXISTS get_organizer_revenue(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_event_tier_revenue(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS get_daily_revenue(UUID, INT) CASCADE;

-- Drop tables (order matters — children first)
DROP TABLE IF EXISTS login_otps CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS ticket_tiers CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Drop enums
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS event_status CASCADE;
DROP TYPE IF EXISTS reservation_status CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS ticket_status CASCADE;

-- ══════════════════════════════════
-- PHASE 1: EXTENSIONS
-- ══════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════
-- PHASE 2: ENUMS
-- ══════════════════════════════════

CREATE TYPE user_role AS ENUM ('attendee', 'organizer', 'admin');
CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE reservation_status AS ENUM ('active', 'expired', 'converted');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'refunded', 'failed');
CREATE TYPE ticket_status AS ENUM ('valid', 'scanned', 'cancelled');

-- ══════════════════════════════════
-- PHASE 3: TABLES
-- ══════════════════════════════════

-- ── PROFILES ──
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  role user_role DEFAULT 'attendee',
  avatar_url TEXT,
  stripe_customer_id TEXT,
  otp_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── EVENTS ──
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organizer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  cover_image TEXT,
  category TEXT DEFAULT 'general',
  venue TEXT NOT NULL,
  venue_address TEXT,
  city TEXT DEFAULT 'Cairo',
  date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  status event_status DEFAULT 'published',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_status_date ON events(status, date);
CREATE INDEX idx_events_organizer ON events(organizer_id);

-- ── TICKET TIERS ──
CREATE TABLE ticket_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  capacity INT NOT NULL DEFAULT 100,
  sold_count INT NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tiers_event ON ticket_tiers(event_id);

-- ── RESERVATIONS ──
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ticket_tier_id UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
  quantity INT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  status reservation_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reservations_status ON reservations(status, expires_at);
CREATE INDEX idx_reservations_tier ON reservations(ticket_tier_id, status);
CREATE INDEX idx_reservations_user ON reservations(user_id);

-- ── ORDERS ──
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'egp',
  status order_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_stripe ON orders(stripe_session_id);

-- ── TICKETS ──
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_tier_id UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  qr_hash TEXT NOT NULL UNIQUE,
  status ticket_status DEFAULT 'valid',
  scanned_at TIMESTAMPTZ,
  scanned_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tickets_order ON tickets(order_id);
CREATE INDEX idx_tickets_user ON tickets(user_id);
CREATE INDEX idx_tickets_qr ON tickets(qr_hash);
CREATE INDEX idx_tickets_tier_status ON tickets(ticket_tier_id, status);

-- ── LOGIN OTPs ──
CREATE TABLE login_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  verified BOOLEAN DEFAULT false,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_login_otps_user_id ON login_otps(user_id);
CREATE INDEX idx_login_otps_expires ON login_otps(expires_at);

-- ══════════════════════════════════
-- PHASE 4: UTILITY FUNCTIONS & TRIGGERS
-- ══════════════════════════════════

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════
-- PHASE 5: HANDLE NEW USER TRIGGER
-- Supports email signup + Google OAuth
-- ══════════════════════════════════

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    ),
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'role', 'attendee')::user_role,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    updated_at = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't block user creation
  RAISE WARNING 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ══════════════════════════════════
-- PHASE 6: BUSINESS LOGIC FUNCTIONS
-- ══════════════════════════════════

-- Atomic reservation with concurrency safety
CREATE OR REPLACE FUNCTION create_reservation(
  p_user_id UUID,
  p_tier_id UUID,
  p_quantity INT DEFAULT 1
)
RETURNS TABLE(
  reservation_id UUID,
  expires_at TIMESTAMPTZ,
  tier_name TEXT,
  tier_price DECIMAL,
  event_title TEXT,
  event_id UUID
) AS $$
DECLARE
  v_available INT;
  v_tier RECORD;
  v_reservation_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  SELECT
    tt.id, tt.name, tt.price, tt.capacity, tt.event_id,
    e.title AS event_title,
    tt.capacity - COALESCE((
      SELECT SUM(r.quantity) FROM reservations r
      WHERE r.ticket_tier_id = tt.id AND r.status = 'active'
    ), 0) - COALESCE((
      SELECT COUNT(*) FROM tickets t
      WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid', 'scanned')
    ), 0) AS available
  INTO v_tier
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id
  FOR UPDATE OF tt;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  IF v_tier.available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available. Only % remaining.', v_tier.available;
  END IF;

  v_expires := NOW() + INTERVAL '10 minutes';

  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active')
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT
    v_reservation_id,
    v_expires,
    v_tier.name,
    v_tier.price,
    v_tier.event_title,
    v_tier.event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get tier availability
CREATE OR REPLACE FUNCTION get_tier_availability(p_tier_id UUID)
RETURNS INT AS $$
DECLARE
  v_available INT;
BEGIN
  SELECT
    tt.capacity - COALESCE((
      SELECT SUM(r.quantity) FROM reservations r
      WHERE r.ticket_tier_id = tt.id AND r.status = 'active'
    ), 0) - COALESCE((
      SELECT COUNT(*) FROM tickets t
      WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid', 'scanned')
    ), 0)
  INTO v_available
  FROM ticket_tiers tt
  WHERE tt.id = p_tier_id;

  RETURN COALESCE(v_available, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Expire stale reservations
CREATE OR REPLACE FUNCTION expire_stale_reservations()
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE reservations
  SET status = 'expired'
  WHERE status = 'active' AND expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment sold count (called by webhook)
CREATE OR REPLACE FUNCTION increment_sold_count(
  p_tier_id UUID,
  p_amount INT DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  UPDATE ticket_tiers
  SET sold_count = sold_count + p_amount
  WHERE id = p_tier_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- PHASE 7: OTP SYSTEM
-- ══════════════════════════════════

-- Generate OTP (called by authenticated user directly)
CREATE OR REPLACE FUNCTION generate_login_otp()
RETURNS TABLE(otp_code text, masked_email text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_code text;
  v_masked text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM login_otps
    WHERE user_id = v_user_id AND verified = false
    AND created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before requesting a new code';
  END IF;

  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_user_id;
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  UPDATE login_otps SET verified = true WHERE user_id = v_user_id AND verified = false;

  INSERT INTO login_otps (user_id, email, code_hash, expires_at)
  VALUES (v_user_id, v_email, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '5 minutes');

  v_masked := left(v_email, 2) || '***@' || split_part(v_email, '@', 2);
  RETURN QUERY SELECT v_code, v_masked;
END;
$$;

-- Generate OTP for specific user (used by Edge Function with service role)
CREATE OR REPLACE FUNCTION generate_login_otp_for_user(p_user_id uuid)
RETURNS TABLE(otp_code text, masked_email text, user_email text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_email text;
  v_code text;
  v_masked text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM login_otps
    WHERE user_id = p_user_id AND verified = false
    AND created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before requesting a new code';
  END IF;

  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  UPDATE login_otps SET verified = true WHERE user_id = p_user_id AND verified = false;

  INSERT INTO login_otps (user_id, email, code_hash, expires_at)
  VALUES (p_user_id, v_email, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '5 minutes');

  v_masked := left(v_email, 2) || '***@' || split_part(v_email, '@', 2);
  RETURN QUERY SELECT v_code, v_masked, v_email;
END;
$$;

-- Verify OTP
CREATE OR REPLACE FUNCTION verify_login_otp(p_code text)
RETURNS TABLE(is_verified boolean, error_message text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_otp record;
  v_code_hash text;
  v_remaining int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Not authenticated'::text;
    RETURN;
  END IF;

  SELECT * INTO v_otp FROM login_otps
  WHERE user_id = v_user_id AND verified = false AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;

  IF v_otp IS NULL THEN
    RETURN QUERY SELECT false, 'No valid code found. Please request a new one.'::text;
    RETURN;
  END IF;

  IF v_otp.attempts >= 5 THEN
    UPDATE login_otps SET verified = true WHERE id = v_otp.id;
    RETURN QUERY SELECT false, 'Too many attempts. Please request a new code.'::text;
    RETURN;
  END IF;

  UPDATE login_otps SET attempts = v_otp.attempts + 1 WHERE id = v_otp.id;

  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');
  IF v_code_hash != v_otp.code_hash THEN
    v_remaining := 4 - v_otp.attempts;
    RETURN QUERY SELECT false, ('Invalid code. ' || v_remaining || ' attempt(s) remaining.')::text;
    RETURN;
  END IF;

  UPDATE login_otps SET verified = true WHERE id = v_otp.id;
  RETURN QUERY SELECT true, null::text;
END;
$$;

-- Cleanup expired OTPs
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS void AS $$
BEGIN
  DELETE FROM login_otps WHERE expires_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- PHASE 8: FINANCIAL DASHBOARD FUNCTIONS
-- ══════════════════════════════════

CREATE OR REPLACE FUNCTION get_organizer_revenue(p_organizer_id UUID)
RETURNS TABLE(
  event_id UUID,
  event_title TEXT,
  event_date TIMESTAMPTZ,
  event_status TEXT,
  total_tickets_sold BIGINT,
  total_capacity BIGINT,
  gross_revenue NUMERIC,
  platform_fee NUMERIC,
  net_revenue NUMERIC,
  scanned_count BIGINT,
  scan_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS event_id,
    e.title::TEXT AS event_title,
    e.date AS event_date,
    e.status::TEXT AS event_status,
    COALESCE((
      SELECT COUNT(*) FROM tickets t
      JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
      WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0)::BIGINT AS total_tickets_sold,
    COALESCE(SUM(tt.capacity), 0)::BIGINT AS total_capacity,
    COALESCE((
      SELECT SUM(tt3.price) FROM tickets t
      JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id
      WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) AS gross_revenue,
    COALESCE((
      SELECT SUM(tt3.price) FROM tickets t
      JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id
      WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) * 0.05 AS platform_fee,
    COALESCE((
      SELECT SUM(tt3.price) FROM tickets t
      JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id
      WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) * 0.95 AS net_revenue,
    COALESCE((
      SELECT COUNT(*) FROM tickets t
      JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
      WHERE tt2.event_id = e.id AND t.status = 'scanned'
    ), 0)::BIGINT AS scanned_count,
    CASE WHEN COALESCE((
      SELECT COUNT(*) FROM tickets t
      JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
      WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')
    ), 0) > 0
    THEN ROUND(
      COALESCE((
        SELECT COUNT(*) FROM tickets t
        JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
        WHERE tt2.event_id = e.id AND t.status = 'scanned'
      ), 0)::NUMERIC /
      GREATEST(COALESCE((
        SELECT COUNT(*) FROM tickets t
        JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id
        WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')
      ), 1)::NUMERIC, 1) * 100, 1)
    ELSE 0
    END AS scan_rate
  FROM events e
  LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
  WHERE e.organizer_id = p_organizer_id
  GROUP BY e.id, e.title, e.date, e.status
  ORDER BY e.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_event_tier_revenue(p_event_id UUID, p_organizer_id UUID)
RETURNS TABLE(
  tier_id UUID,
  tier_name TEXT,
  tier_price NUMERIC,
  capacity INT,
  sold BIGINT,
  revenue NUMERIC,
  scanned BIGINT
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = p_organizer_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: You do not own this event';
  END IF;

  RETURN QUERY
  SELECT
    tt.id AS tier_id,
    tt.name::TEXT AS tier_name,
    tt.price AS tier_price,
    tt.capacity,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT AS sold,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT * tt.price AS revenue,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status = 'scanned')::BIGINT AS scanned
  FROM ticket_tiers tt
  WHERE tt.event_id = p_event_id
  ORDER BY tt.sort_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_daily_revenue(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE(
  day DATE,
  revenue NUMERIC,
  tickets_sold BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(o.created_at) AS day,
    SUM(o.amount) AS revenue,
    COUNT(DISTINCT t.id)::BIGINT AS tickets_sold
  FROM orders o
  JOIN events e ON e.id = o.event_id
  LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = p_organizer_id
    AND o.status = 'paid'
    AND o.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY DATE(o.created_at)
  ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- PHASE 9: ROW LEVEL SECURITY
-- ══════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_otps ENABLE ROW LEVEL SECURITY;

-- ── PROFILES ──
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Service role can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Organizers can view attendee profiles for their events"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'organizer')
      AND EXISTS (
        SELECT 1 FROM tickets t
        JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
        JOIN events e ON e.id = tt.event_id
        WHERE t.user_id = profiles.id AND e.organizer_id = auth.uid()
      )
    )
  );

-- ── EVENTS ──
CREATE POLICY "Public can view published events"
  ON events FOR SELECT
  USING (status = 'published');

CREATE POLICY "Organizers can view own events"
  ON events FOR SELECT
  USING (organizer_id = auth.uid());

CREATE POLICY "Organizers can create events"
  ON events FOR INSERT
  WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "Organizers can update own events"
  ON events FOR UPDATE
  USING (organizer_id = auth.uid())
  WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "Organizers can delete own draft events"
  ON events FOR DELETE
  USING (organizer_id = auth.uid() AND status = 'draft');

-- ── TICKET TIERS ──
CREATE POLICY "Public can view tiers of published events"
  ON ticket_tiers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.status = 'published'
    )
    OR (
      auth.uid() IS NOT NULL AND
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = ticket_tiers.event_id
        AND e.organizer_id = auth.uid()
      )
    )
  );

CREATE POLICY "Organizers can insert tiers"
  ON ticket_tiers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.organizer_id = auth.uid()
    )
  );

CREATE POLICY "Organizers can update tiers"
  ON ticket_tiers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.organizer_id = auth.uid()
    )
  );

CREATE POLICY "Organizers can delete tiers"
  ON ticket_tiers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_tiers.event_id
      AND e.organizer_id = auth.uid()
    )
  );

-- ── RESERVATIONS ──
CREATE POLICY "Users can view own reservations"
  ON reservations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create reservations"
  ON reservations FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── ORDERS ──
CREATE POLICY "Users can view own orders"
  ON orders FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Organizers can view event orders"
  ON orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = orders.event_id
      AND e.organizer_id = auth.uid()
    )
  );

-- ── TICKETS ──
CREATE POLICY "Users can view own tickets"
  ON tickets FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Organizers can view event tickets"
  ON tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_tiers tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = tickets.ticket_tier_id
      AND e.organizer_id = auth.uid()
    )
  );

-- ── LOGIN OTPs ──
CREATE POLICY "Users can view own OTPs"
  ON login_otps FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own OTPs"
  ON login_otps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own OTPs"
  ON login_otps FOR UPDATE
  USING (auth.uid() = user_id);

-- ══════════════════════════════════
-- PHASE 10: GRANTS & STORAGE
-- ══════════════════════════════════

-- Allow anonymous users to browse events
GRANT SELECT ON events TO anon;
GRANT SELECT ON ticket_tiers TO anon;

-- Storage bucket for event covers
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (drop first to avoid conflicts)
DROP POLICY IF EXISTS "Organizers can upload event covers" ON storage.objects;
DROP POLICY IF EXISTS "Public can view event covers" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can update their event covers" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can delete their event covers" ON storage.objects;

CREATE POLICY "Organizers can upload event covers"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-covers'
    AND auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'organizer')
  );

CREATE POLICY "Public can view event covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-covers');

CREATE POLICY "Organizers can update their event covers"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'event-covers' AND auth.uid() IS NOT NULL);

CREATE POLICY "Organizers can delete their event covers"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'event-covers' AND auth.uid() IS NOT NULL);

-- ══════════════════════════════════
-- PHASE 11: CRON JOBS (if pg_cron enabled)
-- ══════════════════════════════════

DO $$ BEGIN
  PERFORM cron.schedule('expire-reservations', '* * * * *', $cron$ SELECT expire_stale_reservations(); $cron$);
  PERFORM cron.schedule('cleanup-otps', '*/15 * * * *', $cron$ SELECT cleanup_expired_otps(); $cron$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not enabled — skipping cron jobs. Enable it in Dashboard → Database → Extensions.';
END $$;

-- ══════════════════════════════════
-- ✅ DONE! Database is clean and ready.
-- ══════════════════════════════════
-- Next steps:
-- 1. Delete all existing users from Dashboard → Auth → Users
-- 2. Register a fresh account
-- 3. Run seed.sql if you want demo events
-- ══════════════════════════════════
