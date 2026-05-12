-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v25 Phase 6 Task 3
-- Reminder Cron Job: 24-hour event reminder emails
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ REQUIRES: pg_cron extension (available on Supabase Pro+)
-- ⚠️ SAFE TO RUN: Idempotent — unschedules then reschedules.
--
-- BRD Section 16:
--   "يجب إرسال بريد تذكير للمشتري قبل الحدث بـ 24 ساعة"
--   "يجب عدم تكرار الإرسال لنفس التذكرة"
--
-- Architecture:
--   pg_cron (every hour) → send_event_reminders() function
--   → notify_via_edge_function() → send-notification Edge Function
--   → Brevo API → email delivered
--   → email_logs dedup prevents re-sends
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: Enable pg_cron ════════════
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;


-- ════════════ STEP 2: Reminder dispatch function ════════════
-- Finds published events happening in the next 24 hours
-- that have NOT already had reminders sent.

CREATE OR REPLACE FUNCTION send_event_reminders()
RETURNS JSONB AS $func$
DECLARE
  v_event RECORD;
  v_vars JSONB;
  v_dispatched INT := 0;
  v_skipped INT := 0;
  v_origin TEXT := 'https://eventsli.com';
BEGIN
  -- Find events starting within the next 24 hours
  -- that haven't already had reminders dispatched
  FOR v_event IN
    SELECT
      e.id,
      e.title,
      e.date,
      e.venue,
      e.status
    FROM events e
    WHERE e.status = 'published'
      AND e.date >= now()
      AND e.date <= now() + interval '24 hours'
      -- Exclude events that already had reminders dispatched
      AND NOT EXISTS (
        SELECT 1 FROM email_logs el
        WHERE el.event_id = e.id
          AND el.template_name = 'event_reminder'
          AND el.status = 'sent'
        LIMIT 1
      )
  LOOP
    -- Check if event has any valid ticket holders
    IF NOT EXISTS (
      SELECT 1 FROM tickets t
      JOIN ticket_tiers tt ON t.ticket_tier_id = tt.id
      WHERE tt.event_id = v_event.id
        AND t.status IN ('valid', 'used')
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Build template variables
    v_vars := jsonb_build_object(
      'event_title', COALESCE(v_event.title, 'Event'),
      'event_date', COALESCE(to_char(v_event.date, 'Day, Month DD, YYYY at HH12:MI AM'), 'TBD'),
      'event_venue', COALESCE(v_event.venue, 'TBD'),
      'ticket_link', v_origin || '/my-tickets.html'
    );

    -- Dispatch to Edge Function (handles per-recipient sending + dedup)
    PERFORM notify_via_edge_function('event_reminder', v_event.id, v_vars);

    v_dispatched := v_dispatched + 1;

    -- Log that we dispatched for this event (prevents re-dispatch next hour)
    -- The Edge Function will log individual recipient sends in email_logs
    RAISE NOTICE 'Dispatched reminder for event: % (%)', v_event.title, v_event.id;
  END LOOP;

  RETURN jsonb_build_object(
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'run_at', now()
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 3: Schedule the cron job ════════════
-- Runs every hour to catch events entering the 24h window.
-- Deduplication ensures no duplicate sends.

-- Remove existing job if present (idempotent)
SELECT cron.unschedule('eventsli-event-reminders')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'eventsli-event-reminders'
);

-- Schedule: run every hour at minute 0
SELECT cron.schedule(
  'eventsli-event-reminders',          -- job name
  '0 * * * *',                          -- every hour at :00
  $$SELECT send_event_reminders()$$     -- function to call
);


-- ════════════ STEP 4: Manual test helper ════════════
-- Run this to manually trigger reminders (for testing):
--   SELECT send_event_reminders();
--
-- Check cron job status:
--   SELECT * FROM cron.job WHERE jobname = 'eventsli-event-reminders';
--
-- Check cron execution history:
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'eventsli-event-reminders')
--   ORDER BY start_time DESC LIMIT 10;


-- ════════════ ✅ MIGRATION v25 TASK 3 COMPLETE ════════════
--
-- Functions created:
--   ✓ send_event_reminders() — finds events in 24h window, dispatches emails
--
-- Cron job:
--   ✓ eventsli-event-reminders — runs every hour at :00
--
-- Dedup strategy (3 layers):
--   1. SQL: NOT EXISTS(email_logs for event_reminder + event_id)
--   2. Edge Function: checks email_logs per recipient email
--   3. email_logs: template_name + event_id + recipient_email index
--
-- Manual test:
--   SELECT send_event_reminders();
