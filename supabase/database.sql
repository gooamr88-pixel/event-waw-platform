-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Complete Database Setup (Single File)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- IMPORTANT: Delete all users from Auth → Users FIRST,
-- then run this entire script.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ PHASE 0: DROP EVERYTHING ════════════

DO $$ BEGIN PERFORM cron.unschedule('expire-reservations'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('cleanup-otps'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS events_updated_at ON events;
DROP TRIGGER IF EXISTS orders_updated_at ON orders;

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

DROP TABLE IF EXISTS login_otps CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS ticket_tiers CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS event_status CASCADE;
DROP TYPE IF EXISTS reservation_status CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS ticket_status CASCADE;


-- ════════════ PHASE 1: EXTENSIONS ════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ════════════ PHASE 2: ENUMS ════════════

CREATE TYPE user_role AS ENUM ('attendee', 'organizer', 'admin');
CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE reservation_status AS ENUM ('active', 'expired', 'converted');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'refunded', 'failed');
CREATE TYPE ticket_status AS ENUM ('valid', 'scanned', 'cancelled');


-- ════════════ PHASE 3: TABLES ════════════

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


-- ════════════ PHASE 4: UTILITY FUNCTIONS ════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════ PHASE 5: BUSINESS LOGIC ════════════

CREATE OR REPLACE FUNCTION create_reservation(p_user_id UUID, p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE(reservation_id UUID, expires_at TIMESTAMPTZ, tier_name TEXT, tier_price DECIMAL, event_title TEXT, event_id UUID) AS $$
DECLARE v_tier RECORD; v_reservation_id UUID; v_expires TIMESTAMPTZ;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN RAISE EXCEPTION 'Quantity must be between 1 and 10'; END IF;
  SELECT tt.id, tt.name, tt.price, tt.capacity, tt.event_id, e.title AS event_title,
    tt.capacity - COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.ticket_tier_id = tt.id AND r.status = 'active'), 0)
    - COALESCE((SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned')), 0) AS available
  INTO v_tier FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id WHERE tt.id = p_tier_id FOR UPDATE OF tt;
  IF v_tier IS NULL THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;
  IF v_tier.available < p_quantity THEN RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_tier.available; END IF;
  v_expires := NOW() + INTERVAL '10 minutes';
  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active') RETURNING id INTO v_reservation_id;
  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_tier_availability(p_tier_id UUID) RETURNS INT AS $$
DECLARE v_available INT;
BEGIN
  SELECT tt.capacity - COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.ticket_tier_id = tt.id AND r.status = 'active'), 0)
    - COALESCE((SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned')), 0)
  INTO v_available FROM ticket_tiers tt WHERE tt.id = p_tier_id;
  RETURN COALESCE(v_available, 0);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION expire_stale_reservations() RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  UPDATE reservations SET status = 'expired' WHERE status = 'active' AND expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_sold_count(p_tier_id UUID, p_amount INT DEFAULT 1) RETURNS VOID AS $$
BEGIN UPDATE ticket_tiers SET sold_count = sold_count + p_amount WHERE id = p_tier_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PHASE 6: OTP SYSTEM ════════════

CREATE OR REPLACE FUNCTION generate_login_otp()
RETURNS TABLE(otp_code text, masked_email text) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user_id uuid; v_email text; v_code text; v_masked text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM login_otps WHERE user_id = v_user_id AND verified = false AND created_at > now() - interval '60 seconds')
  THEN RAISE EXCEPTION 'Please wait before requesting a new code'; END IF;
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_user_id;
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  UPDATE login_otps SET verified = true WHERE user_id = v_user_id AND verified = false;
  INSERT INTO login_otps (user_id, email, code_hash, expires_at)
  VALUES (v_user_id, v_email, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '5 minutes');
  v_masked := left(v_email, 2) || '***@' || split_part(v_email, '@', 2);
  RETURN QUERY SELECT v_code, v_masked;
END; $$;

CREATE OR REPLACE FUNCTION generate_login_otp_for_user(p_user_id uuid)
RETURNS TABLE(otp_code text, masked_email text, user_email text) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email text; v_code text; v_masked text;
BEGIN
  IF EXISTS (SELECT 1 FROM login_otps WHERE user_id = p_user_id AND verified = false AND created_at > now() - interval '60 seconds')
  THEN RAISE EXCEPTION 'Please wait before requesting a new code'; END IF;
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = p_user_id;
  IF v_email IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  UPDATE login_otps SET verified = true WHERE user_id = p_user_id AND verified = false;
  INSERT INTO login_otps (user_id, email, code_hash, expires_at)
  VALUES (p_user_id, v_email, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '5 minutes');
  v_masked := left(v_email, 2) || '***@' || split_part(v_email, '@', 2);
  RETURN QUERY SELECT v_code, v_masked, v_email;
END; $$;

CREATE OR REPLACE FUNCTION verify_login_otp(p_code text)
RETURNS TABLE(is_verified boolean, error_message text) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user_id uuid; v_otp record; v_code_hash text; v_remaining int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN QUERY SELECT false, 'Not authenticated'::text; RETURN; END IF;
  SELECT * INTO v_otp FROM login_otps WHERE user_id = v_user_id AND verified = false AND expires_at > now() ORDER BY created_at DESC LIMIT 1;
  IF v_otp IS NULL THEN RETURN QUERY SELECT false, 'No valid code found. Request a new one.'::text; RETURN; END IF;
  IF v_otp.attempts >= 5 THEN
    UPDATE login_otps SET verified = true WHERE id = v_otp.id;
    RETURN QUERY SELECT false, 'Too many attempts. Request a new code.'::text; RETURN;
  END IF;
  UPDATE login_otps SET attempts = v_otp.attempts + 1 WHERE id = v_otp.id;
  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');
  IF v_code_hash != v_otp.code_hash THEN
    v_remaining := 4 - v_otp.attempts;
    RETURN QUERY SELECT false, ('Invalid code. ' || v_remaining || ' attempt(s) remaining.')::text; RETURN;
  END IF;
  UPDATE login_otps SET verified = true WHERE id = v_otp.id;
  RETURN QUERY SELECT true, null::text;
END; $$;

CREATE OR REPLACE FUNCTION cleanup_expired_otps() RETURNS void AS $$
BEGIN DELETE FROM login_otps WHERE expires_at < now() - interval '1 hour';
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PHASE 7: FINANCIAL DASHBOARD ════════════

CREATE OR REPLACE FUNCTION get_organizer_revenue(p_organizer_id UUID)
RETURNS TABLE(event_id UUID, event_title TEXT, event_date TIMESTAMPTZ, event_status TEXT,
  total_tickets_sold BIGINT, total_capacity BIGINT, gross_revenue NUMERIC,
  platform_fee NUMERIC, net_revenue NUMERIC, scanned_count BIGINT, scan_rate NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.title::TEXT, e.date, e.status::TEXT,
    COALESCE((SELECT COUNT(*) FROM tickets t JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')), 0)::BIGINT,
    COALESCE(SUM(tt.capacity), 0)::BIGINT,
    COALESCE((SELECT SUM(tt3.price) FROM tickets t JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')), 0),
    COALESCE((SELECT SUM(tt3.price) FROM tickets t JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')), 0) * 0.05,
    COALESCE((SELECT SUM(tt3.price) FROM tickets t JOIN ticket_tiers tt3 ON tt3.id = t.ticket_tier_id WHERE tt3.event_id = e.id AND t.status IN ('valid','scanned')), 0) * 0.95,
    COALESCE((SELECT COUNT(*) FROM tickets t JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id WHERE tt2.event_id = e.id AND t.status = 'scanned'), 0)::BIGINT,
    CASE WHEN COALESCE((SELECT COUNT(*) FROM tickets t JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')), 0) > 0
    THEN ROUND(COALESCE((SELECT COUNT(*) FROM tickets t JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id WHERE tt2.event_id = e.id AND t.status = 'scanned'), 0)::NUMERIC /
      GREATEST(COALESCE((SELECT COUNT(*) FROM tickets t JOIN ticket_tiers tt2 ON tt2.id = t.ticket_tier_id WHERE tt2.event_id = e.id AND t.status IN ('valid','scanned')), 1)::NUMERIC, 1) * 100, 1)
    ELSE 0 END
  FROM events e LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
  WHERE e.organizer_id = p_organizer_id GROUP BY e.id, e.title, e.date, e.status ORDER BY e.date DESC;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_event_tier_revenue(p_event_id UUID, p_organizer_id UUID)
RETURNS TABLE(tier_id UUID, tier_name TEXT, tier_price NUMERIC, capacity INT, sold BIGINT, revenue NUMERIC, scanned BIGINT) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = p_organizer_id) THEN
    RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY SELECT tt.id, tt.name::TEXT, tt.price, tt.capacity,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT * tt.price,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status = 'scanned')::BIGINT
  FROM ticket_tiers tt WHERE tt.event_id = p_event_id ORDER BY tt.sort_order;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_daily_revenue(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, revenue NUMERIC, tickets_sold BIGINT) AS $$
BEGIN
  RETURN QUERY SELECT DATE(o.created_at), SUM(o.amount), COUNT(DISTINCT t.id)::BIGINT
  FROM orders o JOIN events e ON e.id = o.event_id LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = p_organizer_id AND o.status = 'paid' AND o.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY DATE(o.created_at) ORDER BY day;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PHASE 8: ROW LEVEL SECURITY ════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_otps ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- events
CREATE POLICY "events_select_published" ON events FOR SELECT USING (status = 'published');
CREATE POLICY "events_select_own" ON events FOR SELECT USING (organizer_id = auth.uid());
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (organizer_id = auth.uid());
CREATE POLICY "events_update_own" ON events FOR UPDATE USING (organizer_id = auth.uid()) WITH CHECK (organizer_id = auth.uid());
CREATE POLICY "events_delete_draft" ON events FOR DELETE USING (organizer_id = auth.uid() AND status = 'draft');

-- ticket_tiers
CREATE POLICY "tiers_select_published" ON ticket_tiers FOR SELECT USING (
  EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.status = 'published')
  OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid()))
);
CREATE POLICY "tiers_insert" ON ticket_tiers FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid()));
CREATE POLICY "tiers_update" ON ticket_tiers FOR UPDATE USING (
  EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid()));
CREATE POLICY "tiers_delete" ON ticket_tiers FOR DELETE USING (
  EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid()));

-- reservations
CREATE POLICY "reservations_select_own" ON reservations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "reservations_insert" ON reservations FOR INSERT WITH CHECK (user_id = auth.uid());

-- orders
CREATE POLICY "orders_select_own" ON orders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "orders_select_organizer" ON orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM events e WHERE e.id = orders.event_id AND e.organizer_id = auth.uid()));

-- tickets
CREATE POLICY "tickets_select_own" ON tickets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tickets_select_organizer" ON tickets FOR SELECT USING (
  EXISTS (SELECT 1 FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id WHERE tt.id = tickets.ticket_tier_id AND e.organizer_id = auth.uid()));

-- login_otps
CREATE POLICY "otps_select_own" ON login_otps FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "otps_insert" ON login_otps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "otps_update_own" ON login_otps FOR UPDATE USING (auth.uid() = user_id);


-- ════════════ PHASE 9: GRANTS & STORAGE ════════════

-- Anonymous users: read-only access to public event data
GRANT SELECT ON events TO anon;
GRANT SELECT ON ticket_tiers TO anon;

-- Authenticated users: full access to all tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated;

-- Ensure future tables also get the same grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;

INSERT INTO storage.buckets (id, name, public) VALUES ('event-covers', 'event-covers', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "covers_insert" ON storage.objects;
DROP POLICY IF EXISTS "covers_select" ON storage.objects;
DROP POLICY IF EXISTS "covers_update" ON storage.objects;
DROP POLICY IF EXISTS "covers_delete" ON storage.objects;

CREATE POLICY "covers_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'event-covers' AND auth.uid() IS NOT NULL);
CREATE POLICY "covers_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'event-covers');
CREATE POLICY "covers_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'event-covers' AND auth.uid() IS NOT NULL);
CREATE POLICY "covers_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'event-covers' AND auth.uid() IS NOT NULL);


-- ════════════ PHASE 10: CRON (optional) ════════════

DO $$ BEGIN
  PERFORM cron.schedule('expire-reservations', '* * * * *', $c$ SELECT expire_stale_reservations(); $c$);
  PERFORM cron.schedule('cleanup-otps', '*/15 * * * *', $c$ SELECT cleanup_expired_otps(); $c$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not enabled — skipping.';
END $$;


-- ════════════ ✅ DONE ════════════
-- Profile creation is handled by the client code (self-healing).
-- No trigger needed on auth.users.
-- Next: Register a new account and it will work automatically.
