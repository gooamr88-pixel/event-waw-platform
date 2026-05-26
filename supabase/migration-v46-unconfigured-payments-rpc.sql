-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v46: RPC for Unconfigured Payments Email
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION send_unconfigured_payments_email(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_event RECORD;
  v_organizer RECORD;
  v_already_sent BOOLEAN;
  v_vars JSONB;
  v_origin TEXT := 'https://eventsli.com';
BEGIN
  -- 1. Fetch event details
  SELECT id, title, organizer_id, accepted_payment_methods, status
  INTO v_event
  FROM events
  WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  -- 2. Verify status is published
  IF v_event.status != 'published' THEN
    RETURN jsonb_build_object('error', 'Event is not published');
  END IF;

  -- 3. Check if accepted_payment_methods is indeed empty/null
  IF v_event.accepted_payment_methods IS NOT NULL AND array_length(v_event.accepted_payment_methods, 1) > 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Payment methods are already configured');
  END IF;

  -- 4. Check if we already sent the email to prevent double-sending
  SELECT EXISTS (
    SELECT 1 FROM email_logs
    WHERE template_name = 'event_payments_unconfigured'
      AND event_id = p_event_id
  ) INTO v_already_sent;

  IF v_already_sent THEN
    RETURN jsonb_build_object('success', true, 'message', 'Email already sent previously');
  END IF;

  -- 5. Get organizer details
  SELECT full_name, email INTO v_organizer
  FROM profiles
  WHERE id = v_event.organizer_id;

  IF v_organizer IS NULL OR v_organizer.email IS NULL THEN
    RETURN jsonb_build_object('error', 'Organizer profile or email not found');
  END IF;

  -- 6. Build variables
  v_vars := jsonb_build_object(
    'organizer_name', COALESCE(v_organizer.full_name, 'Organizer'),
    'event_title', v_event.title,
    'dashboard_url', v_origin || '/dashboard.html'
  );

  -- 7. Call edge function
  PERFORM notify_via_edge_function('event_payments_unconfigured', p_event_id, v_vars);

  RETURN jsonb_build_object('success', true, 'message', 'Unconfigured payments email triggered successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution permission to authenticated users
GRANT EXECUTE ON FUNCTION send_unconfigured_payments_email(UUID) TO authenticated;
