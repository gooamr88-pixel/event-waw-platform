-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v24 Phase 6 Task 2
-- Notification Triggers: Auto-detect event changes → send emails
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ REQUIRES: pg_net extension (enabled by default on Supabase)
-- ⚠️ SAFE TO RUN: Drops and recreates triggers. Idempotent.
--
-- Architecture:
--   events table UPDATE → Postgres trigger
--   → pg_net.http_post() → send-notification Edge Function
--   → Brevo API → email delivered
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 0: Ensure pg_net is available ════════════
-- pg_net is pre-installed on Supabase but needs to be enabled
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- ════════════ STEP 1: Helper to call the Edge Function ════════════
-- Wraps pg_net.http_post for cleaner trigger code.

CREATE OR REPLACE FUNCTION notify_via_edge_function(
  p_template_name TEXT,
  p_event_id UUID,
  p_variables JSONB
)
RETURNS void AS $func$
DECLARE
  v_url TEXT := 'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/send-notification';
  v_key TEXT;
BEGIN
  -- Read service role key from platform_settings (secure, admin-only table)
  SELECT value->>'service_role_key' INTO v_key
  FROM platform_settings
  WHERE key = 'notification_config';

  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'notification_config.service_role_key not set in platform_settings — notification skipped';
    RETURN;
  END IF;

  -- Fire async HTTP POST via pg_net
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'template_name', p_template_name,
      'event_id', p_event_id,
      'variables', p_variables
    )::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    )
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 2: Trigger Function — Event Status Change ════════════
-- Detects:
--   pending_review → published (approved)
--   pending_review → rejected
--   draft → pending_review (submitted)

CREATE OR REPLACE FUNCTION trg_event_status_notification()
RETURNS TRIGGER AS $func$
DECLARE
  v_organizer_name TEXT;
  v_vars JSONB;
  v_origin TEXT;
BEGIN
  -- Only fire on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get organizer name
  SELECT full_name INTO v_organizer_name
  FROM profiles WHERE id = NEW.organizer_id;

  v_origin := 'https://eventsli.com';

  -- Build common variables
  v_vars := jsonb_build_object(
    'organizer_name', COALESCE(v_organizer_name, 'Organizer'),
    'event_title', COALESCE(NEW.title, 'Untitled Event'),
    'event_date', COALESCE(to_char(NEW.date, 'Day, Month DD, YYYY at HH12:MI AM'), 'TBD'),
    'event_venue', COALESCE(NEW.venue, 'TBD'),
    'dashboard_url', v_origin || '/dashboard.html'
  );

  -- ── Event Approved ──
  IF OLD.status = 'pending_review' AND NEW.admin_approved = true THEN
    PERFORM notify_via_edge_function('event_approved', NEW.id, v_vars);
    RETURN NEW;
  END IF;

  -- ── Event Rejected ──
  IF OLD.admin_approved IS DISTINCT FROM NEW.admin_approved
     AND NEW.admin_approved = false
     AND NEW.admin_rejected_reason IS NOT NULL THEN
    v_vars := v_vars || jsonb_build_object(
      'rejection_reason', COALESCE(NEW.admin_rejected_reason, 'No specific reason provided.')
    );
    PERFORM notify_via_edge_function('event_rejected', NEW.id, v_vars);
    RETURN NEW;
  END IF;

  -- ── Event Submitted for Review ──
  IF OLD.status = 'draft' AND NEW.status = 'pending_review' THEN
    PERFORM notify_via_edge_function('event_created', NEW.id, v_vars);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 3: Trigger Function — Event Date/Venue Change ════════════
-- Only fires for published events with existing ticket holders.
-- Sends "event_changed" email to all buyers.

CREATE OR REPLACE FUNCTION trg_event_details_notification()
RETURNS TRIGGER AS $func$
DECLARE
  v_has_tickets BOOLEAN;
  v_change_parts TEXT[] := '{}';
  v_change_details TEXT;
  v_vars JSONB;
  v_origin TEXT;
BEGIN
  -- Only for published events
  IF NEW.status != 'published' THEN
    RETURN NEW;
  END IF;

  -- Detect which fields changed
  IF OLD.date IS DISTINCT FROM NEW.date THEN
    v_change_parts := array_append(v_change_parts,
      '📅 Date changed from "' || COALESCE(to_char(OLD.date, 'Mon DD, YYYY HH12:MI AM'), 'TBD')
      || '" to "' || COALESCE(to_char(NEW.date, 'Mon DD, YYYY HH12:MI AM'), 'TBD') || '"');
  END IF;

  IF OLD.venue IS DISTINCT FROM NEW.venue THEN
    v_change_parts := array_append(v_change_parts,
      '📍 Venue changed from "' || COALESCE(OLD.venue, 'TBD')
      || '" to "' || COALESCE(NEW.venue, 'TBD') || '"');
  END IF;

  -- Nothing relevant changed
  IF array_length(v_change_parts, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if any tickets exist for this event
  SELECT EXISTS(
    SELECT 1 FROM tickets t
    JOIN ticket_tiers tt ON t.ticket_tier_id = tt.id
    WHERE tt.event_id = NEW.id
      AND t.status IN ('valid', 'used')
  ) INTO v_has_tickets;

  IF NOT v_has_tickets THEN
    RETURN NEW; -- No ticket holders to notify
  END IF;

  v_change_details := array_to_string(v_change_parts, '<br>');

  v_origin := 'https://eventsli.com';

  v_vars := jsonb_build_object(
    'event_title', COALESCE(NEW.title, 'Event'),
    'change_details', v_change_details,
    'event_date', COALESCE(to_char(NEW.date, 'Day, Month DD, YYYY at HH12:MI AM'), 'TBD'),
    'event_venue', COALESCE(NEW.venue, 'TBD'),
    'ticket_link', v_origin || '/my-tickets.html'
  );

  PERFORM notify_via_edge_function('event_changed', NEW.id, v_vars);

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 4: Attach Triggers ════════════

-- Drop existing triggers (idempotent)
DROP TRIGGER IF EXISTS trg_event_status_notify ON events;
DROP TRIGGER IF EXISTS trg_event_details_notify ON events;

-- Status change trigger (approved, rejected, submitted)
CREATE TRIGGER trg_event_status_notify
  AFTER UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION trg_event_status_notification();

-- Date/venue change trigger (buyer notification)
CREATE TRIGGER trg_event_details_notify
  AFTER UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION trg_event_details_notification();


-- ════════════ STEP 5: Seed notification config ════════════
-- Store the service role key securely in platform_settings.
-- ⚠️ REPLACE <YOUR_SERVICE_ROLE_KEY> with the actual key!

INSERT INTO platform_settings (key, value)
VALUES (
  'notification_config',
  '{"service_role_key": "<YOUR_SERVICE_ROLE_KEY>", "origin": "https://eventsli.com"}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ⚠️ After running, UPDATE the key:
-- UPDATE platform_settings
-- SET value = jsonb_set(value, '{service_role_key}', '"eyJhbG...your_real_key"')
-- WHERE key = 'notification_config';


-- ════════════ ✅ MIGRATION v24 TASK 2 COMPLETE ════════════
--
-- Functions created:
--   ✓ notify_via_edge_function(template, event_id, vars)
--   ✓ trg_event_status_notification()
--   ✓ trg_event_details_notification()
--
-- Triggers attached:
--   ✓ trg_event_status_notify → events AFTER UPDATE
--   ✓ trg_event_details_notify → events AFTER UPDATE
--
-- ⚠️ REQUIRED: Update platform_settings with your real service role key:
--   UPDATE platform_settings
--   SET value = jsonb_set(value, '{service_role_key}', '"eyJhbG..."')
--   WHERE key = 'notification_config';
