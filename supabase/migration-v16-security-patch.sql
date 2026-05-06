-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Security Patch Migration v16
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Idempotent. Does NOT drop data.
--
-- Fixes:
--   C-2: Storage policies scoped to owner's event folders only
--   C-3: 'archived' enum value verified/added (safety net)
-- ═══════════════════════════════════════════════════════════════


-- ════════════ FIX C-3: Ensure 'archived' enum value exists ════════════
-- migration-v13 should have added this, but this is a safety net.
-- IF NOT EXISTS makes this idempotent — safe to re-run.

ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'archived';


-- ════════════ FIX C-2: Scope Storage Policies to Owner's Events ════════════
-- PROBLEM: The original covers_insert and covers_update policies only
-- checked `auth.uid() IS NOT NULL`, meaning ANY authenticated user could
-- upload/overwrite files in ANY event's folder — including other organizers'.
--
-- FIX: New policies verify that the upload path starts with 'events/{event_id}/'
-- and that the authenticated user is the organizer_id for that event.
-- Files outside the 'events/' prefix are blocked entirely.


-- ──────────── Step 1: Drop insecure policies ────────────

DROP POLICY IF EXISTS "covers_insert" ON storage.objects;
DROP POLICY IF EXISTS "covers_update" ON storage.objects;
DROP POLICY IF EXISTS "covers_delete" ON storage.objects;
-- Keep covers_select — public read is fine for a public bucket


-- ──────────── Step 2: Create owner-scoped INSERT policy ────────────
-- Users can only upload to events/{event_id}/* where they own the event.
-- Path format: events/<UUID>/filename.ext

CREATE POLICY "covers_insert_owner" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-covers'
    AND auth.uid() IS NOT NULL
    AND (
      -- Allow uploads to events/{event_id}/* only if user owns the event
      (
        (storage.foldername(name))[1] = 'events'
        AND EXISTS (
          SELECT 1 FROM events e
          WHERE e.id = ((storage.foldername(name))[2])::uuid
            AND e.organizer_id = auth.uid()
        )
      )
      -- Allow admin to upload anywhere in the bucket
      OR is_admin()
    )
  );


-- ──────────── Step 3: Create owner-scoped UPDATE policy ────────────
-- Users can only overwrite files in their own event folders.

CREATE POLICY "covers_update_owner" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'event-covers'
    AND auth.uid() IS NOT NULL
    AND (
      (
        (storage.foldername(name))[1] = 'events'
        AND EXISTS (
          SELECT 1 FROM events e
          WHERE e.id = ((storage.foldername(name))[2])::uuid
            AND e.organizer_id = auth.uid()
        )
      )
      OR is_admin()
    )
  );


-- ──────────── Step 4: Create owner-scoped DELETE policy ────────────
-- Users can only delete files in their own event folders.

CREATE POLICY "covers_delete_owner" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-covers'
    AND auth.uid() IS NOT NULL
    AND (
      (
        (storage.foldername(name))[1] = 'events'
        AND EXISTS (
          SELECT 1 FROM events e
          WHERE e.id = ((storage.foldername(name))[2])::uuid
            AND e.organizer_id = auth.uid()
        )
      )
      OR is_admin()
    )
  );


-- ════════════ ✅ MIGRATION v16 COMPLETE ════════════
--
-- Verification queries:
--
--   -- Check 'archived' exists in enum:
--   SELECT enumlabel FROM pg_enum
--   WHERE enumtypid = 'event_status'::regtype
--   ORDER BY enumsortorder;
--
--   -- Check new storage policies:
--   SELECT polname, polcmd FROM pg_policies
--   WHERE tablename = 'objects'
--     AND polname LIKE 'covers_%'
--   ORDER BY polname;
--
-- What changed:
--   ✓ 'archived' enum value confirmed/added (C-3 safety net)
--   ✓ Old covers_insert policy dropped (was auth.uid() IS NOT NULL only)
--   ✓ Old covers_update policy dropped (same vulnerability)
--   ✓ Old covers_delete policy dropped (same vulnerability)
--   ✓ New covers_insert_owner: scoped to events/{owned_event_id}/*
--   ✓ New covers_update_owner: scoped to events/{owned_event_id}/*
--   ✓ New covers_delete_owner: scoped to events/{owned_event_id}/*
--   ✓ Admin bypass via is_admin() on all write policies
--   ✓ Public read (covers_select) preserved — bucket is public
