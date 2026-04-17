-- ═══════════════════════════════════════════════
-- EVENT WAW — Complete Database Schema
-- Supabase PostgreSQL
-- ═══════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════
-- ENUMS
-- ══════════════════════════════════

CREATE TYPE user_role AS ENUM ('attendee', 'organizer', 'admin');
CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE reservation_status AS ENUM ('active', 'expired', 'converted');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'refunded', 'failed');
CREATE TYPE ticket_status AS ENUM ('valid', 'scanned', 'cancelled');

-- ══════════════════════════════════
-- PROFILES
-- ══════════════════════════════════

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  role user_role DEFAULT 'attendee',
  avatar_url TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', NULL),
    COALESCE(NEW.raw_user_meta_data->>'role', 'attendee')::user_role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
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

-- ══════════════════════════════════
-- EVENTS
-- ══════════════════════════════════

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
  status event_status DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_status_date ON events(status, date);
CREATE INDEX idx_events_organizer ON events(organizer_id);

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════
-- TICKET TIERS
-- ══════════════════════════════════

CREATE TABLE ticket_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- e.g. "General", "VIP", "VVIP"
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  capacity INT NOT NULL DEFAULT 100,
  sold_count INT NOT NULL DEFAULT 0,  -- denormalized cache
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tiers_event ON ticket_tiers(event_id);

-- ══════════════════════════════════
-- RESERVATIONS (🔥 Critical for concurrency)
-- ══════════════════════════════════

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

-- ══════════════════════════════════
-- ORDERS
-- ══════════════════════════════════

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

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════
-- TICKETS
-- ══════════════════════════════════

CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_tier_id UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  qr_hash TEXT NOT NULL UNIQUE,  -- HMAC-SHA256 signed payload
  status ticket_status DEFAULT 'valid',
  scanned_at TIMESTAMPTZ,
  scanned_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tickets_order ON tickets(order_id);
CREATE INDEX idx_tickets_user ON tickets(user_id);
CREATE INDEX idx_tickets_qr ON tickets(qr_hash);
CREATE INDEX idx_tickets_tier_status ON tickets(ticket_tier_id, status);

-- ══════════════════════════════════
-- ATOMIC RESERVATION FUNCTION
-- ══════════════════════════════════

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
  -- Validate quantity
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  -- Lock the tier row and compute true availability
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

  -- Create reservation with 10-minute expiry
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

-- ══════════════════════════════════
-- GET TIER AVAILABILITY (for frontend display)
-- ══════════════════════════════════

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

-- ══════════════════════════════════
-- EXPIRE STALE RESERVATIONS
-- ══════════════════════════════════

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

-- ══════════════════════════════════
-- INCREMENT SOLD COUNT (called by webhook)
-- ══════════════════════════════════

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
-- OTP VERIFIED COLUMN (for guard.js)
-- ══════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMPTZ;

-- ══════════════════════════════════
-- GRANT SELECT TO ANON ROLE
-- ══════════════════════════════════
-- Required for unauthenticated users to browse events

GRANT SELECT ON events TO anon;
GRANT SELECT ON ticket_tiers TO anon;

-- ══════════════════════════════════
-- PG_CRON JOBS
-- ══════════════════════════════════
-- NOTE: Enable pg_cron in Supabase Dashboard > Database > Extensions
-- Then run these in the SQL Editor:

-- Expire stale reservations every minute
SELECT cron.schedule(
  'expire-reservations',
  '* * * * *',
  $$ SELECT expire_stale_reservations(); $$
);

-- Cleanup expired OTPs every 15 minutes
SELECT cron.schedule(
  'cleanup-otps',
  '*/15 * * * *',
  $$ SELECT cleanup_expired_otps(); $$
);
