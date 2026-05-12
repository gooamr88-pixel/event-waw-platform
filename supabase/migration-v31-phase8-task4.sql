-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v31 Phase 8 Task 4
-- Waitlist System: Table + Join RPC + Admin Query
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates table, functions. Idempotent.
--
-- BRD Section 20:
--   "يجب توفير قائمة انتظار عندما تنفد التذاكر"
--   "يسجل المستخدم بريده الإلكتروني واسمه للإشعار"
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: waitlist table ════════════

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'converted', 'expired')),
  notified_at TIMESTAMPTZ,
  added_at TIMESTAMPTZ DEFAULT now(),
  
  -- Prevent duplicate entries per event+email
  UNIQUE(event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_event ON waitlist(event_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);

-- RLS
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can join waitlist" ON waitlist;
CREATE POLICY "Anyone can join waitlist" ON waitlist
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users see own waitlist entries" ON waitlist;
CREATE POLICY "Users see own waitlist entries" ON waitlist
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
  );


-- ════════════ STEP 2: join_waitlist RPC ════════════
-- Public-facing RPC: anyone can join (guest or authenticated).
-- Idempotent: returns success if already on waitlist.

CREATE OR REPLACE FUNCTION join_waitlist(
  p_event_id UUID,
  p_email TEXT,
  p_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_event RECORD;
  v_existing UUID;
  v_position INT;
  v_waitlist_id UUID;
BEGIN
  -- ── Validate email ──
  IF p_email IS NULL OR TRIM(p_email) = '' THEN
    RETURN jsonb_build_object('error', 'Email is required');
  END IF;

  IF p_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RETURN jsonb_build_object('error', 'Invalid email format');
  END IF;

  -- ── Check event exists ──
  SELECT id, title, date, status
  INTO v_event
  FROM events
  WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  -- Don't allow waitlist for past events
  IF v_event.date < now() THEN
    RETURN jsonb_build_object('error', 'This event has already ended');
  END IF;

  -- Don't allow waitlist for cancelled events
  IF v_event.status IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('error', 'This event is not accepting registrations');
  END IF;

  -- ── Check if already on waitlist (idempotent) ──
  SELECT id INTO v_existing
  FROM waitlist
  WHERE event_id = p_event_id
    AND LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF v_existing IS NOT NULL THEN
    -- Get position
    SELECT COUNT(*) INTO v_position
    FROM waitlist
    WHERE event_id = p_event_id
      AND status = 'waiting'
      AND added_at <= (SELECT added_at FROM waitlist WHERE id = v_existing);

    RETURN jsonb_build_object(
      'success', true,
      'already_registered', true,
      'waitlist_id', v_existing,
      'position', v_position,
      'message', 'You are already on the waitlist!'
    );
  END IF;

  -- ── Insert new entry ──
  INSERT INTO waitlist (event_id, email, full_name, phone, user_id)
  VALUES (
    p_event_id,
    LOWER(TRIM(p_email)),
    TRIM(COALESCE(p_name, '')),
    TRIM(COALESCE(p_phone, '')),
    v_user_id
  )
  RETURNING id INTO v_waitlist_id;

  -- Get position
  SELECT COUNT(*) INTO v_position
  FROM waitlist
  WHERE event_id = p_event_id
    AND status = 'waiting';

  RETURN jsonb_build_object(
    'success', true,
    'waitlist_id', v_waitlist_id,
    'position', v_position,
    'event_title', v_event.title,
    'message', 'You have been added to the waitlist. We will notify you if spots open up!'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 3: admin_get_waitlist RPC ════════════
-- Returns waitlist entries for an event (for organizer/admin).

CREATE OR REPLACE FUNCTION get_event_waitlist(
  p_event_id UUID
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  -- Must be organizer or admin
  IF NOT EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_user_id AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
      RETURN jsonb_build_object('error', 'Unauthorized');
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.added_at ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      w.id,
      w.email,
      w.full_name,
      w.phone,
      w.status,
      w.added_at,
      w.notified_at,
      ROW_NUMBER() OVER (ORDER BY w.added_at ASC) AS position
    FROM waitlist w
    WHERE w.event_id = p_event_id
      AND w.status = 'waiting'
  ) r;

  RETURN v_result;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════ STEP 4: Grants ════════════
GRANT EXECUTE ON FUNCTION join_waitlist(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION join_waitlist(UUID, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_event_waitlist(UUID) TO authenticated;


-- ════════════ ✅ MIGRATION v31 TASK 4 COMPLETE ════════════
--
-- Created:
--   ✓ waitlist table (event_id, email, name, phone, status)
--   ✓ UNIQUE(event_id, email) — no duplicates
--   ✓ join_waitlist(event_id, email, name, phone) → JSONB
--   ✓ get_event_waitlist(event_id) → JSONB array
--
-- Security:
--   ✓ RLS enabled — users see only their own entries
--   ✓ Admins see all entries
--   ✓ join_waitlist accessible by anon (guests)
--   ✓ Past/cancelled events blocked
--   ✓ Idempotent: returns position if already registered
--
-- Test:
--   SELECT join_waitlist('event-uuid', 'fan@email.com', 'Fan Name');
--   SELECT get_event_waitlist('event-uuid');
