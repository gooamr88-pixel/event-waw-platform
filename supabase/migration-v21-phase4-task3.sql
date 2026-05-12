-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v21 Phase 4 Task 3
-- Backend Enforcement: No-Single-Seat (Orphan) Rule
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Drops and recreates reserve_seats +
--    reserve_guest_seats with orphan detection. Idempotent.
--
-- BRD Section 22:
--   "النظام يجب أن يمنع المستخدم من اختيار مقاعد تترك كرسي
--    مفرد معزول بين مقاعد محجوزة أو مختارة"
--
-- WHAT THIS CHANGES:
--   1. Adds check_orphan_seats() helper function
--   2. Updates reserve_seats() to call orphan check before locking
--   3. Updates reserve_guest_seats() to call orphan check
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: Orphan Detection Helper ════════════
-- Returns TRUE if the given seat_ids would create an orphan in any row.
-- This is a pure validation function — no side effects.

DROP FUNCTION IF EXISTS check_orphan_seats(UUID[]);

CREATE OR REPLACE FUNCTION check_orphan_seats(
  p_seat_ids UUID[]
)
RETURNS TABLE(
  has_orphan    BOOLEAN,
  orphan_section TEXT,
  orphan_row    TEXT,
  orphan_seat   TEXT
) AS $func$
DECLARE
  v_section TEXT;
  v_row     TEXT;
BEGIN
  -- For each unique (section_key, row_label) touched by the requested seats
  FOR v_section, v_row IN
    SELECT DISTINCT s.section_key, s.row_label
    FROM seats s
    WHERE s.id = ANY(p_seat_ids)
  LOOP
    -- Use CTEs with window functions to detect orphans efficiently
    RETURN QUERY
    WITH row_seats AS (
      SELECT
        s.id AS seat_id,
        s.seat_number,
        s.section_key,
        s.row_label,
        CASE
          WHEN s.status IN ('sold', 'reserved') THEN true
          WHEN s.id = ANY(p_seat_ids) THEN true
          ELSE false
        END AS is_occupied,
        ROW_NUMBER() OVER (ORDER BY (s.seat_number::int) ASC) AS pos,
        COUNT(*) OVER () AS total_seats
      FROM seats s
      WHERE s.section_key = v_section
        AND s.row_label = v_row
    ),
    with_neighbors AS (
      SELECT
        rs.*,
        COALESCE(
          (SELECT is_occupied FROM row_seats WHERE pos = rs.pos - 1),
          true  -- wall = occupied
        ) AS left_occupied,
        COALESCE(
          (SELECT is_occupied FROM row_seats WHERE pos = rs.pos + 1),
          true  -- wall = occupied
        ) AS right_occupied
      FROM row_seats rs
    )
    SELECT
      true AS has_orphan,
      wn.section_key AS orphan_section,
      wn.row_label AS orphan_row,
      wn.seat_number AS orphan_seat
    FROM with_neighbors wn
    WHERE wn.is_occupied = false
      AND wn.left_occupied = true
      AND wn.right_occupied = true
      AND wn.total_seats >= 3;

  END LOOP;

  RETURN;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════ STEP 2: Update reserve_seats() ════════════
-- Adds orphan check BEFORE locking seats.

DROP FUNCTION IF EXISTS reserve_seats(UUID, UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_seats(
  p_user_id UUID,
  p_seat_ids UUID[],
  p_tier_id  UUID
)
RETURNS JSONB AS $func$
DECLARE
  v_event_id     UUID;
  v_event_title  TEXT;
  v_tier_name    TEXT;
  v_tier_price   DECIMAL;
  v_reservation  UUID;
  v_orphan       RECORD;
BEGIN
  -- 1. Validate tier exists and get event info
  SELECT tt.name, tt.price, tt.event_id, e.title
  INTO v_tier_name, v_tier_price, v_event_id, v_event_title
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id;

  IF v_tier_name IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  -- 2. ══ ORPHAN CHECK (Phase 4) ══
  -- Run BEFORE locking to fail fast
  SELECT * INTO v_orphan
  FROM check_orphan_seats(p_seat_ids)
  WHERE has_orphan = true
  LIMIT 1;

  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot reserve: would leave isolated seat at Row %, Seat % (Section %). Please select adjacent seats.',
      v_orphan.orphan_row, v_orphan.orphan_seat, v_orphan.orphan_section;
  END IF;

  -- 3. Lock the requested seats (SKIP LOCKED prevents deadlocks)
  -- Verify all seats are available and belong to the correct tier
  PERFORM 1
  FROM seats s
  WHERE s.id = ANY(p_seat_ids)
    AND s.status = 'available'
    AND s.tier_id = p_tier_id
  FOR UPDATE SKIP LOCKED;

  -- Check we got all the seats we asked for
  IF (SELECT COUNT(*) FROM seats WHERE id = ANY(p_seat_ids) AND status = 'available' AND tier_id = p_tier_id) != array_length(p_seat_ids, 1) THEN
    RAISE EXCEPTION 'One or more seats are no longer available';
  END IF;

  -- 4. Create reservation
  v_reservation := gen_random_uuid();

  INSERT INTO reservations (id, user_id, event_id, tier_id, quantity, status, expires_at)
  VALUES (
    v_reservation,
    p_user_id,
    v_event_id,
    p_tier_id,
    array_length(p_seat_ids, 1),
    'active',
    now() + interval '10 minutes'  -- BRD: 10-minute lock
  );

  -- 5. Mark seats as reserved
  UPDATE seats
  SET status = 'reserved',
      reservation_id = v_reservation
  WHERE id = ANY(p_seat_ids);

  -- 6. Return reservation details
  RETURN jsonb_build_object(
    'reservation_id', v_reservation,
    'event_id', v_event_id,
    'event_title', v_event_title,
    'tier_id', p_tier_id,
    'tier_name', v_tier_name,
    'tier_price', v_tier_price,
    'seat_count', array_length(p_seat_ids, 1),
    'expires_at', (now() + interval '10 minutes')
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 3: Update reserve_guest_seats() ════════════
-- Same orphan check for guest checkout path.

DROP FUNCTION IF EXISTS reserve_guest_seats(UUID[], UUID);

CREATE OR REPLACE FUNCTION reserve_guest_seats(
  p_seat_ids UUID[],
  p_tier_id  UUID
)
RETURNS JSONB AS $func$
DECLARE
  v_event_id     UUID;
  v_event_title  TEXT;
  v_tier_name    TEXT;
  v_tier_price   DECIMAL;
  v_reservation  UUID;
  v_orphan       RECORD;
BEGIN
  -- 1. Validate tier
  SELECT tt.name, tt.price, tt.event_id, e.title
  INTO v_tier_name, v_tier_price, v_event_id, v_event_title
  FROM ticket_tiers tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = p_tier_id;

  IF v_tier_name IS NULL THEN
    RAISE EXCEPTION 'Ticket tier not found';
  END IF;

  -- 2. ══ ORPHAN CHECK (Phase 4) ══
  SELECT * INTO v_orphan
  FROM check_orphan_seats(p_seat_ids)
  WHERE has_orphan = true
  LIMIT 1;

  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot reserve: would leave isolated seat at Row %, Seat % (Section %). Please select adjacent seats.',
      v_orphan.orphan_row, v_orphan.orphan_seat, v_orphan.orphan_section;
  END IF;

  -- 3. Lock seats
  PERFORM 1
  FROM seats s
  WHERE s.id = ANY(p_seat_ids)
    AND s.status = 'available'
    AND s.tier_id = p_tier_id
  FOR UPDATE SKIP LOCKED;

  IF (SELECT COUNT(*) FROM seats WHERE id = ANY(p_seat_ids) AND status = 'available' AND tier_id = p_tier_id) != array_length(p_seat_ids, 1) THEN
    RAISE EXCEPTION 'One or more seats are no longer available';
  END IF;

  -- 4. Create guest reservation (no user_id)
  v_reservation := gen_random_uuid();

  INSERT INTO reservations (id, user_id, event_id, tier_id, quantity, status, expires_at)
  VALUES (
    v_reservation,
    NULL,  -- guest: no user
    v_event_id,
    p_tier_id,
    array_length(p_seat_ids, 1),
    'active',
    now() + interval '10 minutes'  -- BRD: 10-minute lock
  );

  -- 5. Mark seats as reserved
  UPDATE seats
  SET status = 'reserved',
      reservation_id = v_reservation
  WHERE id = ANY(p_seat_ids);

  -- 6. Return reservation details
  RETURN jsonb_build_object(
    'reservation_id', v_reservation,
    'event_id', v_event_id,
    'event_title', v_event_title,
    'tier_id', p_tier_id,
    'tier_name', v_tier_name,
    'tier_price', v_tier_price,
    'seat_count', array_length(p_seat_ids, 1),
    'expires_at', (now() + interval '10 minutes')
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 4: Grant Permissions ════════════

GRANT EXECUTE ON FUNCTION check_orphan_seats(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_seats(UUID, UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_guest_seats(UUID[], UUID) TO authenticated, anon;


-- ════════════ ✅ MIGRATION v21 TASK 3 COMPLETE ════════════
--
-- Functions updated:
--   ✓ check_orphan_seats(seat_ids[])      — pure validation helper
--   ✓ reserve_seats(user_id, seat_ids[], tier_id)     — with orphan check
--   ✓ reserve_guest_seats(seat_ids[], tier_id)        — with orphan check
--
-- Verification:
--
--   -- Test orphan detection (replace with real seat IDs):
--   SELECT * FROM check_orphan_seats(ARRAY['<seat_id_1>', '<seat_id_2>']::UUID[]);
--
--   -- Should raise exception if orphan would be created:
--   SELECT reserve_seats('<user_id>', ARRAY['<seat_id>']::UUID[], '<tier_id>');
