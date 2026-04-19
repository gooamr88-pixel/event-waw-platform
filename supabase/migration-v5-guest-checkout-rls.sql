-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Migration v5: Guest Checkout + Multi-Tenant RLS
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Does NOT drop tables or data.
-- Two upgrades:
--   1. Guest checkout support (no auth.users account required)
--   2. Strict multi-tenant organizer isolation via RLS
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════
-- PART A: GUEST CHECKOUT — Schema Changes
-- ════════════════════════════════════════════════════════════════

-- 1. Guest tokens table — for secure ticket retrieval without login
CREATE TABLE IF NOT EXISTS guest_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 of the token sent via email
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  used_count INT DEFAULT 0,
  max_uses INT DEFAULT 50,  -- Prevent unlimited scraping
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guest_tokens_hash ON guest_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_guest_tokens_order ON guest_tokens(order_id);

ALTER TABLE guest_tokens ENABLE ROW LEVEL SECURITY;
-- No RLS policy for guest_tokens — only service_role can access
-- Guest retrieval goes through an Edge Function, not direct DB access


-- 2. Make user_id NULLABLE on orders table to support guest purchases
--    Guest orders will have user_id = NULL and is_guest = TRUE
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_national_id TEXT;

-- Index for guest order lookups
CREATE INDEX IF NOT EXISTS idx_orders_guest_email ON orders(guest_email) WHERE is_guest = true;


-- 3. Make user_id NULLABLE on tickets table
ALTER TABLE tickets ALTER COLUMN user_id DROP NOT NULL;

-- 4. Make user_id NULLABLE on reservations table (guests get reservations too)
ALTER TABLE reservations ALTER COLUMN user_id DROP NOT NULL;


-- ════════════════════════════════════════════════════════════════
-- PART B: GUEST RESERVATION FUNCTION
-- Only callable from Edge Functions via service_role.
-- All SQL uses EXECUTE to prevent Supabase pre-parser issues.
-- ════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS create_guest_reservation(UUID, INT);

CREATE OR REPLACE FUNCTION create_guest_reservation(p_tier_id UUID, p_quantity INT DEFAULT 1)
RETURNS JSONB AS $func$
DECLARE
  v_name TEXT; v_price DECIMAL; v_eid UUID; v_etitle TEXT; v_oid UUID;
  v_cap INT; v_reserved BIGINT; v_sold BIGINT; v_available INT;
  v_expires TIMESTAMPTZ; v_rid UUID;
BEGIN
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  EXECUTE 'SELECT tt.name, tt.price, tt.event_id, e.title, e.organizer_id, tt.capacity
    FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id
    WHERE tt.id = $1 FOR UPDATE OF tt'
  INTO v_name, v_price, v_eid, v_etitle, v_oid, v_cap
  USING p_tier_id;

  IF v_name IS NULL THEN RAISE EXCEPTION 'Ticket tier not found'; END IF;

  EXECUTE 'SELECT COALESCE(SUM(quantity), 0) FROM reservations
    WHERE ticket_tier_id = $1 AND status = ''active'''
  INTO v_reserved USING p_tier_id;

  EXECUTE 'SELECT COUNT(*) FROM tickets
    WHERE ticket_tier_id = $1 AND status IN (''valid'',''scanned'')'
  INTO v_sold USING p_tier_id;

  v_available := v_cap - v_reserved - v_sold;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets. Only % remaining.', v_available;
  END IF;

  v_expires := NOW() + INTERVAL '35 minutes';

  EXECUTE 'INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
    VALUES (NULL, $1, $2, $3, ''active'') RETURNING id'
  INTO v_rid USING p_tier_id, p_quantity, v_expires;

  RETURN jsonb_build_object(
    'reservation_id', v_rid, 'expires_at', v_expires,
    'tier_name', v_name, 'tier_price', v_price,
    'event_title', v_etitle, 'event_id', v_eid, 'organizer_id', v_oid
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════════
-- PART C: GUEST TOKEN GENERATION FUNCTION (service_role only)
-- ════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS create_guest_token(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_guest_token(p_order_id UUID, p_email TEXT, p_raw_token TEXT)
RETURNS UUID AS $func$
DECLARE v_token_id UUID;
BEGIN
  EXECUTE 'INSERT INTO guest_tokens (order_id, token_hash, email, expires_at)
    VALUES ($1, encode(digest($2, ''sha256''), ''hex''), $3, now() + interval ''90 days'')
    RETURNING id'
  INTO v_token_id USING p_order_id, p_raw_token, p_email;

  RETURN v_token_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════════
-- PART D: GUEST TOKEN VERIFICATION (service_role only)
-- ════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS verify_guest_token(TEXT);

CREATE OR REPLACE FUNCTION verify_guest_token(p_token_hash TEXT)
RETURNS JSONB AS $func$
DECLARE
  v_tid UUID; v_oid UUID; v_exp TIMESTAMPTZ;
  v_used INT; v_max INT; v_email TEXT; v_gname TEXT;
BEGIN
  EXECUTE 'SELECT gt.id, gt.order_id, gt.expires_at, gt.used_count, gt.max_uses,
    o.guest_email, o.guest_name
    FROM guest_tokens gt JOIN orders o ON o.id = gt.order_id
    WHERE gt.token_hash = $1 LIMIT 1'
  INTO v_tid, v_oid, v_exp, v_used, v_max, v_email, v_gname
  USING p_token_hash;

  IF v_tid IS NULL THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  IF v_exp < now() THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  IF v_used >= v_max THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  EXECUTE 'UPDATE guest_tokens SET used_count = used_count + 1 WHERE id = $1'
  USING v_tid;

  RETURN jsonb_build_object(
    'order_id', v_oid, 'guest_email', v_email,
    'guest_name', v_gname, 'is_valid', true
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-enable body validation for remaining functions
SET check_function_bodies = true;


-- ════════════════════════════════════════════════════════════════
-- PART E: STRICT MULTI-TENANT RLS ISOLATION FOR ORGANIZERS
-- Drop all existing policies and rebuild with strict isolation.
-- ════════════════════════════════════════════════════════════════

-- ──── E1. EVENTS — Organizers see ONLY their own events ────

DROP POLICY IF EXISTS "events_select_published" ON events;
DROP POLICY IF EXISTS "events_select_own" ON events;
DROP POLICY IF EXISTS "events_insert" ON events;
DROP POLICY IF EXISTS "events_update_own" ON events;
DROP POLICY IF EXISTS "events_delete_draft" ON events;

-- Anyone (including anon) can see published events
CREATE POLICY "events_anon_select_published" ON events FOR SELECT
  USING (status = 'published');

-- Organizers can see ALL their own events (any status)
CREATE POLICY "events_organizer_select_own" ON events FOR SELECT
  USING (organizer_id = auth.uid());

-- Only the organizer can insert events under their own ID
CREATE POLICY "events_organizer_insert" ON events FOR INSERT
  WITH CHECK (organizer_id = auth.uid());

-- Only the organizer can update their own events
CREATE POLICY "events_organizer_update" ON events FOR UPDATE
  USING (organizer_id = auth.uid())
  WITH CHECK (organizer_id = auth.uid());

-- Only the organizer can delete their own draft events
CREATE POLICY "events_organizer_delete" ON events FOR DELETE
  USING (organizer_id = auth.uid() AND status = 'draft');


-- ──── E2. TICKET_TIERS — Strict organizer isolation ────

DROP POLICY IF EXISTS "tiers_select_published" ON ticket_tiers;
DROP POLICY IF EXISTS "tiers_insert" ON ticket_tiers;
DROP POLICY IF EXISTS "tiers_update" ON ticket_tiers;
DROP POLICY IF EXISTS "tiers_delete" ON ticket_tiers;

-- Anyone can see tiers of published events
CREATE POLICY "tiers_anon_select_published" ON ticket_tiers FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.status = 'published')
  );

-- Organizers can see tiers of their own events (any status)
CREATE POLICY "tiers_organizer_select_own" ON ticket_tiers FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid())
  );

-- Organizers can only create tiers under their own events
CREATE POLICY "tiers_organizer_insert" ON ticket_tiers FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid())
  );

-- Organizers can only update tiers of their own events
CREATE POLICY "tiers_organizer_update" ON ticket_tiers FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid())
  );

-- Organizers can only delete tiers of their own events
CREATE POLICY "tiers_organizer_delete" ON ticket_tiers FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_tiers.event_id AND e.organizer_id = auth.uid())
  );


-- ──── E3. ORDERS — Attendees see own + Organizers see their events' orders ────

DROP POLICY IF EXISTS "orders_select_own" ON orders;
DROP POLICY IF EXISTS "orders_select_organizer" ON orders;

-- Authenticated users see their own orders
CREATE POLICY "orders_attendee_select_own" ON orders FOR SELECT
  USING (user_id = auth.uid() AND user_id IS NOT NULL);

-- Organizers see orders for their events ONLY
CREATE POLICY "orders_organizer_select_own_events" ON orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = orders.event_id AND e.organizer_id = auth.uid()
    )
  );


-- ──── E4. TICKETS — Attendees see own + Organizers see their events' tickets ────

DROP POLICY IF EXISTS "tickets_select_own" ON tickets;
DROP POLICY IF EXISTS "tickets_select_organizer" ON tickets;

-- Authenticated users see their own tickets
CREATE POLICY "tickets_attendee_select_own" ON tickets FOR SELECT
  USING (user_id = auth.uid() AND user_id IS NOT NULL);

-- Organizers see tickets for their events ONLY
CREATE POLICY "tickets_organizer_select_own_events" ON tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_tiers tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = tickets.ticket_tier_id AND e.organizer_id = auth.uid()
    )
  );


-- ──── E5. RESERVATIONS — Strict user isolation ────

DROP POLICY IF EXISTS "reservations_select_own" ON reservations;

-- Users see their own reservations only
CREATE POLICY "reservations_select_own" ON reservations FOR SELECT
  USING (user_id = auth.uid() AND user_id IS NOT NULL);


-- ════════════════════════════════════════════════════════════════
-- PART F: SECURE FINANCIAL RPCs — Strict auth.uid() Filtering
-- Ensures organizers CANNOT pass another organizer's ID.
-- ════════════════════════════════════════════════════════════════

-- F1. get_organizer_revenue — ALWAYS uses auth.uid(), ignores p_organizer_id
DROP FUNCTION IF EXISTS get_organizer_revenue(UUID);

CREATE OR REPLACE FUNCTION get_organizer_revenue(p_organizer_id UUID)
RETURNS TABLE(
  event_id UUID, event_title TEXT, event_date TIMESTAMPTZ, event_status TEXT,
  total_tickets_sold BIGINT, total_capacity BIGINT, gross_revenue NUMERIC,
  platform_fee NUMERIC, net_revenue NUMERIC, scanned_count BIGINT, scan_rate NUMERIC
) AS $func$
DECLARE
  v_caller_id UUID;
BEGIN
  -- SECURITY: Always use the authenticated caller's ID, never the parameter
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Override: ignore p_organizer_id, use v_caller_id
  RETURN QUERY
  WITH ticket_stats AS (
    SELECT
      tt.event_id AS ev_id,
      COUNT(*) FILTER (WHERE t.status IN ('valid','scanned')) AS sold,
      COUNT(*) FILTER (WHERE t.status = 'scanned') AS scanned,
      COALESCE(SUM(tt.price) FILTER (WHERE t.status IN ('valid','scanned')), 0) AS revenue
    FROM tickets t
    JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
    GROUP BY tt.event_id
  ),
  capacity_stats AS (
    SELECT ct.event_id AS ev_id, SUM(ct.capacity)::BIGINT AS total_cap
    FROM ticket_tiers ct GROUP BY ct.event_id
  )
  SELECT
    e.id, e.title::TEXT, e.date, e.status::TEXT,
    COALESCE(ts.sold, 0)::BIGINT,
    COALESCE(cs.total_cap, 0)::BIGINT,
    COALESCE(ts.revenue, 0),
    COALESCE(ts.revenue, 0) * 0.05,
    COALESCE(ts.revenue, 0) * 0.95,
    COALESCE(ts.scanned, 0)::BIGINT,
    CASE WHEN COALESCE(ts.sold, 0) > 0
      THEN ROUND(COALESCE(ts.scanned, 0)::NUMERIC / GREATEST(ts.sold, 1) * 100, 1)
      ELSE 0 END
  FROM events e
  LEFT JOIN ticket_stats ts ON ts.ev_id = e.id
  LEFT JOIN capacity_stats cs ON cs.ev_id = e.id
  WHERE e.organizer_id = v_caller_id   -- ← ALWAYS auth.uid()
  ORDER BY e.date DESC;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_organizer_revenue(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_organizer_revenue(UUID) FROM anon;


-- F2. get_event_tier_revenue — Validates ownership via auth.uid()
DROP FUNCTION IF EXISTS get_event_tier_revenue(UUID, UUID);

CREATE OR REPLACE FUNCTION get_event_tier_revenue(p_event_id UUID, p_organizer_id UUID)
RETURNS TABLE(tier_id UUID, tier_name TEXT, tier_price NUMERIC, capacity INT, sold BIGINT, revenue NUMERIC, scanned BIGINT) AS $func$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- SECURITY: Verify the event belongs to the caller, not p_organizer_id
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_caller_id) THEN
    RAISE EXCEPTION 'Unauthorized: event does not belong to you';
  END IF;

  RETURN QUERY SELECT tt.id, tt.name::TEXT, tt.price, tt.capacity,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT * tt.price,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status = 'scanned')::BIGINT
  FROM ticket_tiers tt WHERE tt.event_id = p_event_id ORDER BY tt.sort_order;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_event_tier_revenue(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_event_tier_revenue(UUID, UUID) FROM anon;


-- F3. get_daily_revenue — Always filters by auth.uid()
DROP FUNCTION IF EXISTS get_daily_revenue(UUID, INT);

CREATE OR REPLACE FUNCTION get_daily_revenue(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, revenue NUMERIC, tickets_sold BIGINT) AS $func$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY SELECT DATE(o.created_at), SUM(o.amount), COUNT(DISTINCT t.id)::BIGINT
  FROM orders o
  JOIN events e ON e.id = o.event_id
  LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = v_caller_id   -- ← ALWAYS auth.uid()
    AND o.status = 'paid'
    AND o.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY DATE(o.created_at) ORDER BY day;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_daily_revenue(UUID, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_daily_revenue(UUID, INT) FROM anon;


-- ════════════════════════════════════════════════════════════════
-- PART G: GRANTS FOR NEW TABLE
-- ════════════════════════════════════════════════════════════════

-- guest_tokens: no grants to authenticated/anon — service_role only
-- The Edge Function (verify-guest-ticket) runs with service_role

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ════════════════════════════════════════════════════════════════
-- ✅ DONE
-- ════════════════════════════════════════════════════════════════
-- Verification queries:
--
--   -- Check guest columns on orders:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name LIKE 'guest_%';
--
--   -- Check user_id is now nullable on orders:
--   SELECT is_nullable FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'user_id';
--   -- Expected: YES
--
--   -- Check RLS policies:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
--   -- Verify organizer isolation — simulate as Organizer A:
--   -- SELECT * FROM events; -- Should only return Organizer A's events + published events
--
--   -- Verify get_organizer_revenue ignores parameter:
--   -- SELECT * FROM get_organizer_revenue('attacker-id-here');
--   -- Should still return data for the CALLER, not the parameter.
