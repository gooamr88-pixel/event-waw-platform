-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v55: Gatekeeper Backend Preparation
-- Phase 0: Backend hardening for Flutter Ticket Scanner app
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Purely additive (ALTER ADD, CREATE IF NOT EXISTS).
-- Uses CREATE OR REPLACE for functions. No data loss.
--
-- Tasks:
--   0.1: Enhance gate_team table (new columns for Flutter app)
--   0.2: Create scanner_sessions table
--   0.3: Create authenticate_scanner RPC
--   0.4: Create start/end scanner session RPCs
--   0.5: Create sync_offline_scans RPC
--   0.6: Fix reservation timeout (10min → 32min)
--   0.7: Expand scans table + update scan_ticket RPC
-- ═══════════════════════════════════════════════════════════════


-- ════════════ TASK 0.1: Enhance gate_team table ════════════
-- Add columns needed by the Flutter Gatekeeper app:
--   • staff_user_id: linked when staff logs into the Flutter app
--   • role: scanner (default) or gate_lead (can view stats + override)
--   • device_id: track which device the staff member uses
--   • last_active_at: heartbeat for online/offline tracking
--   • accepted_at: when staff accepted the invitation

ALTER TABLE public.gate_team ADD COLUMN IF NOT EXISTS
  staff_user_id UUID REFERENCES auth.users(id);

ALTER TABLE public.gate_team ADD COLUMN IF NOT EXISTS
  role TEXT DEFAULT 'scanner';

-- Add CHECK constraint for role (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gate_team_role_check'
  ) THEN
    ALTER TABLE public.gate_team ADD CONSTRAINT gate_team_role_check
      CHECK (role IN ('scanner', 'gate_lead'));
  END IF;
END $$;

ALTER TABLE public.gate_team ADD COLUMN IF NOT EXISTS
  device_id TEXT;

ALTER TABLE public.gate_team ADD COLUMN IF NOT EXISTS
  last_active_at TIMESTAMPTZ;

ALTER TABLE public.gate_team ADD COLUMN IF NOT EXISTS
  accepted_at TIMESTAMPTZ;

-- Index for Flutter app lookups by user_id
CREATE INDEX IF NOT EXISTS idx_gate_team_staff_user_id
  ON public.gate_team(staff_user_id);

-- RLS: staff can also read by staff_user_id (in addition to existing email policy)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'gate_team_staff_read_by_uid' AND tablename = 'gate_team'
  ) THEN
    CREATE POLICY gate_team_staff_read_by_uid ON public.gate_team
      FOR SELECT USING (staff_user_id = auth.uid());
  END IF;
END $$;


-- ════════════ TASK 0.2: Create scanner_sessions table ════════════
-- Tracks individual scanning sessions for analytics and monitoring.
-- One row per "gate team member opens scanner for event X".

CREATE TABLE IF NOT EXISTS public.scanner_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_team_id      UUID REFERENCES public.gate_team(id) ON DELETE CASCADE,
  event_id          UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_info       JSONB DEFAULT '{}',
  started_at        TIMESTAMPTZ DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  total_scans       INT DEFAULT 0,
  successful_scans  INT DEFAULT 0,
  rejected_scans    INT DEFAULT 0,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scanner_sessions_event
  ON public.scanner_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_scanner_sessions_user
  ON public.scanner_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_scanner_sessions_active
  ON public.scanner_sessions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_scanner_sessions_gate_team
  ON public.scanner_sessions(gate_team_id);

ALTER TABLE public.scanner_sessions ENABLE ROW LEVEL SECURITY;

-- Scanner can see their own sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'scanner_sessions_select_own' AND tablename = 'scanner_sessions'
  ) THEN
    CREATE POLICY scanner_sessions_select_own ON public.scanner_sessions
      FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

-- Organizer can see sessions for their events
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'scanner_sessions_select_organizer' AND tablename = 'scanner_sessions'
  ) THEN
    CREATE POLICY scanner_sessions_select_organizer ON public.scanner_sessions
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id = scanner_sessions.event_id
          AND e.organizer_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Admin can see all sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'scanner_sessions_select_admin' AND tablename = 'scanner_sessions'
  ) THEN
    CREATE POLICY scanner_sessions_select_admin ON public.scanner_sessions
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
      );
  END IF;
END $$;

-- Users can create their own sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'scanner_sessions_insert_own' AND tablename = 'scanner_sessions'
  ) THEN
    CREATE POLICY scanner_sessions_insert_own ON public.scanner_sessions
      FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Users can update their own sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'scanner_sessions_update_own' AND tablename = 'scanner_sessions'
  ) THEN
    CREATE POLICY scanner_sessions_update_own ON public.scanner_sessions
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.scanner_sessions TO authenticated;


-- ════════════ TASK 0.3: Create authenticate_scanner RPC ════════════
-- Called when a gate team member opens the Flutter app.
-- Returns their assigned events + scan permissions.
-- Also auto-links staff_user_id when matching by email.

CREATE OR REPLACE FUNCTION authenticate_scanner()
RETURNS JSONB AS $func$
DECLARE
  v_user_id     UUID := auth.uid();
  v_email       TEXT;
  v_assignments JSONB;
  v_own_events  JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Get user email
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- ═══ Auto-link: Set staff_user_id for any gate_team rows matching this email ═══
  UPDATE public.gate_team
  SET staff_user_id = v_user_id,
      status = 'active',
      accepted_at = COALESCE(accepted_at, now()),
      last_active_at = now()
  WHERE LOWER(staff_email) = LOWER(v_email)
    AND staff_user_id IS NULL
    AND status IN ('invited', 'active');

  -- ═══ Fetch gate team assignments (by user_id OR email) ═══
  SELECT COALESCE(jsonb_agg(row_to_json(gt)::jsonb ORDER BY gt.event_date DESC NULLS LAST), '[]'::jsonb)
  INTO v_assignments
  FROM (
    SELECT
      g.id             AS gate_team_id,
      g.organizer_id,
      g.event_id,
      g.role,
      g.status,
      e.id             AS event_id_resolved,
      e.title          AS event_title,
      e.date           AS event_date,
      e.end_date       AS event_end_date,
      e.venue          AS event_venue,
      e.cover_image    AS event_cover_image,
      e.status         AS event_status,
      p.full_name      AS organizer_name
    FROM public.gate_team g
    LEFT JOIN public.events e ON e.id = g.event_id
    LEFT JOIN public.profiles p ON p.id = g.organizer_id
    WHERE (g.staff_user_id = v_user_id OR LOWER(g.staff_email) = LOWER(v_email))
      AND g.status IN ('invited', 'active')
  ) gt;

  -- ═══ Fetch events the user organizes directly ═══
  SELECT COALESCE(jsonb_agg(row_to_json(ev)::jsonb ORDER BY ev.date DESC NULLS LAST), '[]'::jsonb)
  INTO v_own_events
  FROM (
    SELECT
      e.id,
      e.title,
      e.date,
      e.end_date,
      e.venue,
      e.cover_image,
      e.status
    FROM public.events e
    WHERE e.organizer_id = v_user_id
      AND e.status IN ('published', 'draft')
  ) ev;

  -- ═══ Update heartbeat on all linked gate_team rows ═══
  UPDATE public.gate_team
  SET last_active_at = now()
  WHERE staff_user_id = v_user_id
    AND status = 'active';

  RETURN jsonb_build_object(
    'authorized', (jsonb_array_length(v_assignments) > 0 OR jsonb_array_length(v_own_events) > 0),
    'assignments', v_assignments,
    'own_events', v_own_events,
    'user_id', v_user_id,
    'email', v_email
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION authenticate_scanner() TO authenticated;
REVOKE EXECUTE ON FUNCTION authenticate_scanner() FROM anon;


-- ════════════ TASK 0.4: Scanner session management RPCs ════════════

-- ── start_scanner_session ──
-- Called when scanner begins scanning for a specific event.
CREATE OR REPLACE FUNCTION start_scanner_session(
  p_event_id    UUID,
  p_device_info JSONB DEFAULT '{}'
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id      UUID := auth.uid();
  v_email        TEXT;
  v_gate_team_id UUID;
  v_is_organizer BOOLEAN := false;
  v_is_admin     BOOLEAN := false;
  v_session_id   UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Check if event exists
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  -- Get email for gate_team lookup
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Check authorization: gate_team member?
  SELECT g.id INTO v_gate_team_id
  FROM public.gate_team g
  WHERE (g.staff_user_id = v_user_id OR LOWER(g.staff_email) = LOWER(v_email))
    AND (g.event_id = p_event_id OR g.event_id IS NULL)
    AND g.status IN ('invited', 'active')
  LIMIT 1;

  -- Check authorization: event organizer?
  IF v_gate_team_id IS NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.events WHERE id = p_event_id AND organizer_id = v_user_id
    ) INTO v_is_organizer;
  END IF;

  -- Check authorization: admin?
  IF v_gate_team_id IS NULL AND NOT v_is_organizer THEN
    SELECT EXISTS(
      SELECT 1 FROM public.profiles WHERE id = v_user_id AND role IN ('admin', 'super_admin')
    ) INTO v_is_admin;
  END IF;

  IF v_gate_team_id IS NULL AND NOT v_is_organizer AND NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Not authorized to scan for this event');
  END IF;

  -- End any previously active sessions for this user + event
  UPDATE public.scanner_sessions
  SET is_active = false, ended_at = now()
  WHERE user_id = v_user_id
    AND event_id = p_event_id
    AND is_active = true;

  -- Create new session
  INSERT INTO public.scanner_sessions (
    gate_team_id, event_id, user_id, device_info
  ) VALUES (
    v_gate_team_id, p_event_id, v_user_id, p_device_info
  ) RETURNING id INTO v_session_id;

  -- Update gate_team heartbeat + device
  IF v_gate_team_id IS NOT NULL THEN
    UPDATE public.gate_team
    SET last_active_at = now(),
        device_id = COALESCE(p_device_info->>'device_id', device_id)
    WHERE id = v_gate_team_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'event_id', p_event_id,
    'gate_team_id', v_gate_team_id,
    'started_at', now()
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── end_scanner_session ──
-- Called when scanner stops scanning or closes the app.
CREATE OR REPLACE FUNCTION end_scanner_session(p_session_id UUID)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_session RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.scanner_sessions
  WHERE id = p_session_id AND user_id = v_user_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found or not yours');
  END IF;

  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('error', 'Session already ended');
  END IF;

  UPDATE public.scanner_sessions
  SET is_active = false, ended_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'total_scans', v_session.total_scans,
    'successful_scans', v_session.successful_scans,
    'rejected_scans', v_session.rejected_scans,
    'duration_seconds', EXTRACT(EPOCH FROM (now() - v_session.started_at))::INT
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_scanner_session(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION end_scanner_session(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION start_scanner_session(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION end_scanner_session(UUID) FROM anon;


-- ════════════ TASK 0.5: sync_offline_scans RPC ════════════
-- Processes a batch of offline scans from the Flutter app.
-- Each scan is validated individually — one failure doesn't abort the batch.
-- Returns per-scan results for the app to reconcile its local cache.

CREATE OR REPLACE FUNCTION sync_offline_scans(
  p_event_id    UUID,
  p_session_id  UUID,
  p_scans       JSONB    -- Array of {ticket_id, scanned_at, device_info}
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id      UUID := auth.uid();
  v_email        TEXT;
  v_authorized   BOOLEAN := false;
  v_results      JSONB := '[]'::jsonb;
  v_scan         JSONB;
  v_ticket       RECORD;
  v_tier         RECORD;
  v_ticket_id    UUID;
  v_scanned_at   TIMESTAMPTZ;
  v_device_info  TEXT;
  v_is_unlimited BOOLEAN;
  v_new_count    INT;
  v_new_status   TEXT;
  v_scan_result  TEXT;
  v_scan_id      UUID;
  v_scans_left   INT;
  v_synced       INT := 0;
  v_rejected     INT := 0;
  v_already      INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Get email for auth check
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- ═══ Verify authorization ═══
  -- Check: gate_team member, event organizer, or admin
  SELECT EXISTS(
    SELECT 1 FROM public.gate_team g
    WHERE (g.staff_user_id = v_user_id OR LOWER(g.staff_email) = LOWER(v_email))
      AND (g.event_id = p_event_id OR g.event_id IS NULL)
      AND g.status IN ('invited', 'active')
  ) OR EXISTS(
    SELECT 1 FROM public.events WHERE id = p_event_id AND organizer_id = v_user_id
  ) OR EXISTS(
    SELECT 1 FROM public.profiles WHERE id = v_user_id AND role IN ('admin', 'super_admin')
  )
  INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('error', 'Not authorized to sync scans for this event');
  END IF;

  -- Validate input
  IF p_scans IS NULL OR jsonb_array_length(p_scans) = 0 THEN
    RETURN jsonb_build_object('error', 'No scans to sync', 'results', '[]'::jsonb);
  END IF;

  -- Cap batch size to prevent abuse
  IF jsonb_array_length(p_scans) > 500 THEN
    RETURN jsonb_build_object('error', 'Batch too large. Maximum 500 scans per sync.');
  END IF;

  -- ═══ Process each scan individually ═══
  FOR v_scan IN SELECT * FROM jsonb_array_elements(p_scans)
  LOOP
    v_ticket_id := (v_scan->>'ticket_id')::UUID;
    v_scanned_at := COALESCE((v_scan->>'scanned_at')::TIMESTAMPTZ, now());
    v_device_info := COALESCE(v_scan->>'device_info', 'Flutter Gatekeeper (offline)');

    BEGIN
      -- Lock ticket row
      SELECT t.*
      INTO v_ticket
      FROM public.tickets t
      WHERE t.id = v_ticket_id
      FOR UPDATE;

      IF v_ticket IS NULL THEN
        v_results := v_results || jsonb_build_object(
          'ticket_id', v_ticket_id,
          'sync_result', 'rejected',
          'message', 'Ticket not found',
          'server_scan_count', 0
        );
        v_rejected := v_rejected + 1;
        CONTINUE;
      END IF;

      -- Check ticket status
      IF v_ticket.status IN ('cancelled', 'revoked', 'refunded') THEN
        v_results := v_results || jsonb_build_object(
          'ticket_id', v_ticket_id,
          'sync_result', 'rejected',
          'message', 'Ticket is ' || v_ticket.status,
          'server_scan_count', COALESCE(v_ticket.scan_count, 0)
        );
        v_rejected := v_rejected + 1;
        CONTINUE;
      END IF;

      -- Check scan limits
      v_is_unlimited := COALESCE(v_ticket.max_scans_allowed, 0) = 0;
      v_new_count := COALESCE(v_ticket.scan_count, 0) + 1;

      IF NOT v_is_unlimited AND v_ticket.scan_count >= v_ticket.max_scans_allowed THEN
        -- Max already reached on server — this offline scan is stale
        v_results := v_results || jsonb_build_object(
          'ticket_id', v_ticket_id,
          'sync_result', 'already_scanned',
          'message', 'Max scans already reached on server (' || v_ticket.scan_count || '/' || v_ticket.max_scans_allowed || ')',
          'server_scan_count', v_ticket.scan_count
        );
        v_already := v_already + 1;
        CONTINUE;
      END IF;

      -- Determine scan result
      IF COALESCE(v_ticket.scan_count, 0) = 0 THEN
        v_scan_result := 'admitted';
      ELSE
        v_scan_result := 're_entry';
      END IF;

      -- Determine new status
      IF NOT v_is_unlimited AND v_new_count >= v_ticket.max_scans_allowed THEN
        v_new_status := 'used';
      ELSE
        v_new_status := 'valid';
      END IF;

      -- Fetch tier for event_id
      SELECT tt.event_id INTO v_tier
      FROM public.ticket_tiers tt WHERE tt.id = v_ticket.ticket_tier_id;

      -- Insert scan record
      v_scan_id := gen_random_uuid();
      INSERT INTO public.scans (id, ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes, source, scanned_at)
      VALUES (
        v_scan_id,
        v_ticket_id,
        COALESCE(v_tier.event_id, p_event_id),
        v_user_id,
        v_scan_result,
        v_device_info,
        'offline_sync',
        'Offline scan synced. Original scan time: ' || v_scanned_at::TEXT,
        'offline_sync',
        v_scanned_at
      );

      -- Update ticket
      UPDATE public.tickets
      SET scan_count = v_new_count,
          status = v_new_status,
          scanned_at = COALESCE(scanned_at, v_scanned_at)
      WHERE id = v_ticket_id;

      -- Calculate remaining
      IF v_is_unlimited THEN
        v_scans_left := -1;
      ELSE
        v_scans_left := v_ticket.max_scans_allowed - v_new_count;
      END IF;

      v_results := v_results || jsonb_build_object(
        'ticket_id', v_ticket_id,
        'sync_result', 'synced',
        'scan_result', v_scan_result,
        'message', 'Scan synced successfully',
        'server_scan_count', v_new_count,
        'scans_remaining', v_scans_left,
        'scan_id', v_scan_id
      );
      v_synced := v_synced + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Individual scan failure — don't abort the batch
      v_results := v_results || jsonb_build_object(
        'ticket_id', v_ticket_id,
        'sync_result', 'error',
        'message', SQLERRM,
        'server_scan_count', -1
      );
      v_rejected := v_rejected + 1;
    END;
  END LOOP;

  -- ═══ Update scanner session totals ═══
  IF p_session_id IS NOT NULL THEN
    UPDATE public.scanner_sessions
    SET total_scans = total_scans + v_synced + v_rejected + v_already,
        successful_scans = successful_scans + v_synced,
        rejected_scans = rejected_scans + v_rejected
    WHERE id = p_session_id AND user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'synced', v_synced,
    'already_scanned', v_already,
    'rejected', v_rejected,
    'total_processed', v_synced + v_already + v_rejected,
    'results', v_results
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION sync_offline_scans(UUID, UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION sync_offline_scans(UUID, UUID, JSONB) FROM anon;


-- ════════════ TASK 0.6: Fix reservation timeout alignment ════════════
-- BRD FIX: Reservation TTL was 10 minutes but Stripe session is 30.5 minutes.
-- This gap could cause double-booking. Aligning to 32 minutes (30.5min + 1.5min buffer).

-- Fix 0.6a: Authenticated reservation
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
  v_expires := NOW() + INTERVAL '32 minutes';  -- v55 FIX: Was 10min, now aligned with Stripe session TTL (30.5min + buffer)
  INSERT INTO reservations (user_id, ticket_tier_id, quantity, expires_at, status)
  VALUES (p_user_id, p_tier_id, p_quantity, v_expires, 'active') RETURNING id INTO v_reservation_id;
  RETURN QUERY SELECT v_reservation_id, v_expires, v_tier.name, v_tier.price, v_tier.event_title, v_tier.event_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- Fix 0.6b: Guest reservation
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

  v_expires := NOW() + INTERVAL '32 minutes';  -- v55 FIX: Was 10min, now aligned with Stripe session TTL (30.5min + buffer)

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

GRANT EXECUTE ON FUNCTION create_reservation(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_guest_reservation(UUID, INT) TO anon;


-- ════════════ TASK 0.7: Expand scans table + update scan_ticket RPC ════════════

-- 0.7a: Add notes and source columns to scans
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS
  notes TEXT;

ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS
  source TEXT DEFAULT 'online';

-- Add/update CHECK constraint for source
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scans_source_check'
  ) THEN
    ALTER TABLE public.scans ADD CONSTRAINT scans_source_check
      CHECK (source IN ('online', 'offline_sync', 'manual_checkin'));
  END IF;
END $$;

-- 0.7b: Update scan_result CHECK to include all result types used by scan_ticket RPC
-- The original CHECK only had: valid, exit, already_used, invalid, cancelled, expired, wrong_event
-- scan_ticket RPC uses: admitted, re_entry, rejected, duplicate
ALTER TABLE public.scans DROP CONSTRAINT IF EXISTS scans_scan_result_check;
ALTER TABLE public.scans ADD CONSTRAINT scans_scan_result_check
  CHECK (scan_result IN (
    'valid', 'exit', 'already_used', 'invalid', 'cancelled', 'expired', 'wrong_event',
    'admitted', 're_entry', 'rejected', 'duplicate'
  ));

-- 0.7c: Update scan_ticket RPC — add p_notes and p_source parameters
-- Preserves ALL existing logic exactly as-is from migration-v22-phase5-task1.sql

DROP FUNCTION IF EXISTS scan_ticket(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS scan_ticket(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION scan_ticket(
  p_ticket_id   UUID,
  p_scanned_by  UUID,
  p_device_info TEXT DEFAULT '',
  p_ip_address  TEXT DEFAULT '',
  p_notes       TEXT DEFAULT NULL,
  p_source      TEXT DEFAULT 'online'
)
RETURNS JSONB AS $func$
DECLARE
  v_ticket       RECORD;
  v_tier         RECORD;
  v_event        RECORD;
  v_scan_result  TEXT;
  v_scan_id      UUID;
  v_is_unlimited BOOLEAN;
  v_scans_left   INT;
  v_new_count    INT;
  v_new_status   TEXT;
  v_buyer_name   TEXT;
  v_cooldown_ms  INT := 3000; -- 3 second cooldown between scans
  v_last_scan    TIMESTAMPTZ;
BEGIN
  -- ═══ 1. Lock ticket row (prevents concurrent scans) ═══
  SELECT t.*
  INTO v_ticket
  FROM tickets t
  WHERE t.id = p_ticket_id
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    -- Still log the failed attempt
    INSERT INTO scans (ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes, source)
    VALUES (p_ticket_id, NULL, p_scanned_by, 'rejected', p_device_info, p_ip_address, COALESCE(p_notes, 'Ticket not found'), p_source);

    RETURN jsonb_build_object(
      'valid', false,
      'scan_result', 'rejected',
      'message', 'Ticket not found',
      'ticket_id', p_ticket_id
    );
  END IF;

  -- ═══ 2. Check ticket status ═══
  IF v_ticket.status IN ('cancelled', 'revoked', 'refunded') THEN
    INSERT INTO scans (ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes, source)
    VALUES (p_ticket_id, v_ticket.ticket_tier_id, p_scanned_by, 'rejected', p_device_info, p_ip_address,
            COALESCE(p_notes, 'Ticket status: ' || v_ticket.status), p_source);

    RETURN jsonb_build_object(
      'valid', false,
      'scan_result', 'rejected',
      'message', 'Ticket is ' || v_ticket.status,
      'ticket_id', p_ticket_id,
      'status', v_ticket.status
    );
  END IF;

  -- ═══ 3. Anti-rapid-scan cooldown ═══
  SELECT MAX(s.scanned_at) INTO v_last_scan
  FROM scans s
  WHERE s.ticket_id = p_ticket_id
    AND s.scan_result IN ('admitted', 're_entry');

  IF v_last_scan IS NOT NULL AND
     (extract(epoch from (now() - v_last_scan)) * 1000) < v_cooldown_ms THEN
    RETURN jsonb_build_object(
      'valid', true,
      'scan_result', 'duplicate',
      'message', 'Already scanned (cooldown active)',
      'ticket_id', p_ticket_id,
      'cooldown_remaining_ms', v_cooldown_ms - (extract(epoch from (now() - v_last_scan)) * 1000)::INT
    );
  END IF;

  -- ═══ 4. Fetch tier + event for context ═══
  SELECT tt.name, tt.price, tt.max_scans, tt.event_id
  INTO v_tier
  FROM ticket_tiers tt
  WHERE tt.id = v_ticket.ticket_tier_id;

  SELECT e.title, e.venue, e.date
  INTO v_event
  FROM events e
  WHERE e.id = v_tier.event_id;

  -- ═══ 5. Determine scan limits ═══
  v_is_unlimited := COALESCE(v_ticket.max_scans_allowed, 0) = 0;
  v_new_count := COALESCE(v_ticket.scan_count, 0) + 1;

  IF NOT v_is_unlimited AND v_ticket.scan_count >= v_ticket.max_scans_allowed THEN
    INSERT INTO scans (ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes, source)
    VALUES (p_ticket_id, v_tier.event_id, p_scanned_by, 'rejected', p_device_info, p_ip_address,
            COALESCE(p_notes, 'Max scans reached: ' || v_ticket.scan_count || '/' || v_ticket.max_scans_allowed), p_source);

    RETURN jsonb_build_object(
      'valid', false,
      'scan_result', 'rejected',
      'message', 'Maximum entries reached (' || v_ticket.max_scans_allowed || ')',
      'ticket_id', p_ticket_id,
      'scan_count', v_ticket.scan_count,
      'max_scans', v_ticket.max_scans_allowed,
      'is_unlimited', false
    );
  END IF;

  -- ═══ 6. Determine scan result type ═══
  IF COALESCE(v_ticket.scan_count, 0) = 0 THEN
    v_scan_result := 'admitted';
  ELSE
    v_scan_result := 're_entry';
  END IF;

  -- ═══ 7. Determine new ticket status ═══
  IF NOT v_is_unlimited AND v_new_count >= v_ticket.max_scans_allowed THEN
    v_new_status := 'used';
  ELSE
    v_new_status := 'valid';
  END IF;

  -- ═══ 8. Insert scan record ═══
  v_scan_id := gen_random_uuid();
  INSERT INTO scans (id, ticket_id, event_id, scanned_by, scan_result, device_info, ip_address, notes, source)
  VALUES (v_scan_id, p_ticket_id, v_tier.event_id, p_scanned_by, v_scan_result, p_device_info, p_ip_address, p_notes, p_source);

  -- ═══ 9. Update ticket ═══
  UPDATE tickets
  SET scan_count = v_new_count,
      status = v_new_status,
      scanned_at = COALESCE(scanned_at, now())
  WHERE id = p_ticket_id;

  -- ═══ 10. Calculate remaining scans ═══
  IF v_is_unlimited THEN
    v_scans_left := -1;
  ELSE
    v_scans_left := v_ticket.max_scans_allowed - v_new_count;
  END IF;

  -- ═══ 11. Get buyer name for display ═══
  BEGIN
    IF v_ticket.user_id IS NOT NULL THEN
      SELECT p.full_name INTO v_buyer_name
      FROM profiles p WHERE p.id = v_ticket.user_id;
    ELSE
      SELECT o.guest_name INTO v_buyer_name
      FROM orders o WHERE o.id = v_ticket.order_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_buyer_name := 'Unknown';
  END;

  -- ═══ 12. Return full context ═══
  RETURN jsonb_build_object(
    'valid', true,
    'scan_result', v_scan_result,
    'message', CASE v_scan_result
      WHEN 'admitted' THEN 'Welcome! First entry.'
      WHEN 're_entry' THEN 'Re-entry confirmed.'
    END,

    'ticket_id', p_ticket_id,
    'ticket_status', v_new_status,
    'scan_id', v_scan_id,

    'scan_count', v_new_count,
    'max_scans', COALESCE(v_ticket.max_scans_allowed, 0),
    'scans_remaining', v_scans_left,
    'is_unlimited', v_is_unlimited,

    'event_title', v_event.title,
    'event_venue', v_event.venue,
    'tier_name', v_tier.name,
    'buyer_name', COALESCE(v_buyer_name, 'Guest'),
    'seat_label', v_ticket.seat_label
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION scan_ticket(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION scan_ticket(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;


-- ════════════ GRANTS (idempotent) ════════════

GRANT SELECT, INSERT, UPDATE ON public.gate_team TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.scanner_sessions TO authenticated;
GRANT SELECT ON public.scans TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ════════════ ✅ MIGRATION v55 COMPLETE ════════════
--
-- Fixes applied:
--   ✓ TASK 0.1: gate_team enhanced (staff_user_id, role, device_id, last_active_at, accepted_at)
--   ✓ TASK 0.2: scanner_sessions table created (with RLS + indexes)
--   ✓ TASK 0.3: authenticate_scanner() RPC (auto-links staff, returns assignments + own events)
--   ✓ TASK 0.4: start_scanner_session() + end_scanner_session() RPCs
--   ✓ TASK 0.5: sync_offline_scans() RPC (batch offline scan processing with per-scan error handling)
--   ✓ TASK 0.6: Reservation TTL 10min → 32min (both auth + guest)
--   ✓ TASK 0.7: scans.notes + scans.source columns, scan_ticket RPC updated
--
-- Verification:
--
--   -- Check gate_team columns:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'gate_team' ORDER BY ordinal_position;
--
--   -- Check scanner_sessions table:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'scanner_sessions' ORDER BY ordinal_position;
--
--   -- Test authenticate_scanner:
--   SELECT authenticate_scanner();
--
--   -- Test session management:
--   SELECT start_scanner_session('<event_id>', '{"model":"iPhone","os":"iOS 18"}'::jsonb);
--
--   -- Test offline sync:
--   SELECT sync_offline_scans(
--     '<event_id>',
--     '<session_id>',
--     '[{"ticket_id":"<id>","scanned_at":"2026-06-02T12:00:00Z","device_info":"Flutter"}]'::jsonb
--   );
--
--   -- Verify reservation TTL (should be ~32 min from now):
--   SELECT create_reservation('<user_id>', '<tier_id>', 1);
--
--   -- Check scans columns:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'scans' AND column_name IN ('notes', 'source');
--
--   -- Test updated scan_ticket:
--   SELECT scan_ticket('<ticket_id>', '<user_id>', 'Flutter/Android', '192.168.1.1', 'Test note', 'online');
