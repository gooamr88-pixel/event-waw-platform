-- ============================================================
-- STEP 1: Fix the broken RLS DELETE policy on events
-- ============================================================

DROP POLICY IF EXISTS "events_organizer_delete" ON public.events;

CREATE POLICY "events_organizer_delete"
ON public.events
FOR DELETE
TO authenticated
USING ( organizer_id = auth.uid() );


-- ============================================================
-- STEP 2: Add ON DELETE CASCADE to all child tables
-- ============================================================
-- Uses DO blocks to discover the actual FK constraint name
-- from pg_constraint, drop it, and re-add with CASCADE.
-- This is idempotent — safe to run multiple times.
-- ============================================================

-- 2a. ticket_tiers.event_id -> events(id) CASCADE
DO $$
DECLARE _con text;
BEGIN
  SELECT con.conname INTO _con
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'ticket_tiers'
    AND nsp.nspname = 'public'
    AND con.contype = 'f'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel.oid
        AND a.attnum = ANY(con.conkey)
        AND a.attname = 'event_id'
    );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ticket_tiers DROP CONSTRAINT %I', _con);
  END IF;
END $$;

ALTER TABLE public.ticket_tiers
  ADD CONSTRAINT ticket_tiers_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


-- 2b. venue_maps.event_id -> events(id) CASCADE
DO $$
DECLARE _con text;
BEGIN
  SELECT con.conname INTO _con
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'venue_maps'
    AND nsp.nspname = 'public'
    AND con.contype = 'f'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel.oid
        AND a.attnum = ANY(con.conkey)
        AND a.attname = 'event_id'
    );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.venue_maps DROP CONSTRAINT %I', _con);
  END IF;
END $$;

ALTER TABLE public.venue_maps
  ADD CONSTRAINT venue_maps_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


-- 2c. seats.venue_map_id -> venue_maps(id) CASCADE
DO $$
DECLARE _con text;
BEGIN
  SELECT con.conname INTO _con
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'seats'
    AND nsp.nspname = 'public'
    AND con.contype = 'f'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel.oid
        AND a.attnum = ANY(con.conkey)
        AND a.attname = 'venue_map_id'
    );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.seats DROP CONSTRAINT %I', _con);
  END IF;
END $$;

ALTER TABLE public.seats
  ADD CONSTRAINT seats_venue_map_id_fkey
  FOREIGN KEY (venue_map_id) REFERENCES public.venue_maps(id) ON DELETE CASCADE;


-- 2d. promo_codes.event_id -> events(id) CASCADE
DO $$
DECLARE _con text;
BEGIN
  SELECT con.conname INTO _con
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'promo_codes'
    AND nsp.nspname = 'public'
    AND con.contype = 'f'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel.oid
        AND a.attnum = ANY(con.conkey)
        AND a.attname = 'event_id'
    );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.promo_codes DROP CONSTRAINT %I', _con);
  END IF;
END $$;

ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


-- 2e. reservations — try both possible FK columns (tier_id or ticket_tier_id)
DO $$
DECLARE _con text;
BEGIN
  -- Check for tier_id FK
  SELECT con.conname INTO _con
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'reservations'
    AND nsp.nspname = 'public'
    AND con.contype = 'f'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel.oid
        AND a.attnum = ANY(con.conkey)
        AND a.attname = 'tier_id'
    );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reservations DROP CONSTRAINT %I', _con);
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_tier_id_fkey
      FOREIGN KEY (tier_id) REFERENCES public.ticket_tiers(id) ON DELETE CASCADE;
    RETURN;
  END IF;

  -- Check for ticket_tier_id FK
  SELECT con.conname INTO _con
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'reservations'
    AND nsp.nspname = 'public'
    AND con.contype = 'f'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel.oid
        AND a.attnum = ANY(con.conkey)
        AND a.attname = 'ticket_tier_id'
    );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reservations DROP CONSTRAINT %I', _con);
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_ticket_tier_id_fkey
      FOREIGN KEY (ticket_tier_id) REFERENCES public.ticket_tiers(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ============================================================
-- STEP 3: Verify the fix
-- ============================================================

-- Should show the corrected policy
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'events' AND policyname = 'events_organizer_delete';

-- Should show all CASCADE FKs
SELECT
  tc.table_name AS child_table,
  kcu.column_name AS fk_column,
  ccu.table_name AS parent_table,
  ccu.column_name AS parent_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN ('events', 'venue_maps', 'ticket_tiers')
  AND tc.table_schema = 'public'
ORDER BY child_table;
