-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v44: Universal Guest Access Fallback
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Redefine approve_manual_order to always generate a guest token ──
CREATE OR REPLACE FUNCTION approve_manual_order(p_manual_order_id UUID)
RETURNS JSONB AS $func$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_mto          RECORD;
  v_event        RECORD;
  v_tier         RECORD;
  v_org_id       UUID;
  v_order_id     UUID;
  v_ticket_ids   UUID[];
  v_ticket_id    UUID;
  v_i            INT;
  v_raw_token    TEXT := NULL;
BEGIN
  -- ═══ 1. VALIDATE: Lock the manual order row ═══
  SELECT mto.*
  INTO v_mto
  FROM manual_transfer_orders mto
  WHERE mto.id = p_manual_order_id
  FOR UPDATE;

  IF v_mto IS NULL THEN
    RETURN jsonb_build_object('error', 'Order not found');
  END IF;

  IF v_mto.status != 'pending_approval' THEN
    RETURN jsonb_build_object('error', 'Order is not pending approval (current: ' || v_mto.status || ')');
  END IF;

  -- ═══ 2. VERIFY: Caller is the event organizer ═══
  SELECT e.organizer_id, e.title, e.venue, e.date
  INTO v_event
  FROM events e WHERE e.id = v_mto.event_id;

  IF v_event.organizer_id != v_caller_id THEN
    RETURN jsonb_build_object('error', 'Only the event organizer can approve this order');
  END IF;

  SELECT tt.name, tt.price INTO v_tier
  FROM ticket_tiers tt WHERE tt.id = v_mto.tier_id;

  -- Resolve organizer_id for payments table
  SELECT org.id INTO v_org_id
  FROM organizers org WHERE org.user_id = v_caller_id;

  -- ═══ 3. CREATE: Real order in orders table ═══
  INSERT INTO orders (
    event_id, reservation_id, amount, currency, status,
    user_id, is_guest, guest_name, guest_email, guest_phone,
    subtotal, tax_amount, platform_fee_amount,
    manual_transfer_order_id, payment_channel
  ) VALUES (
    v_mto.event_id, v_mto.reservation_id, v_mto.total_amount,
    v_mto.currency, 'paid',
    v_mto.user_id,
    v_mto.user_id IS NULL,
    v_mto.buyer_name, v_mto.buyer_email, v_mto.buyer_phone,
    v_mto.subtotal, v_mto.tax_amount, v_mto.platform_fee_total,
    p_manual_order_id, 'manual'
  ) RETURNING id INTO v_order_id;

  -- ═══ 4. CREATE: Tickets ═══
  v_ticket_ids := ARRAY[]::UUID[];
  FOR v_i IN 1..v_mto.quantity LOOP
    v_ticket_id := gen_random_uuid();
    v_ticket_ids := v_ticket_ids || v_ticket_id;

    INSERT INTO tickets (
      id, order_id, ticket_tier_id, user_id,
      qr_hash, status
    ) VALUES (
      v_ticket_id, v_order_id, v_mto.tier_id,
      v_mto.user_id,
      '__PENDING_QR_' || v_ticket_id::TEXT,
      'valid'
    );
  END LOOP;

  -- ═══ 5. CREATE: Payment record ═══
  INSERT INTO payments (
    order_id, event_id, organizer_id,
    subtotal, tax_rate_snapshot, tax_amount,
    platform_fee_pct, platform_fee_total,
    total_amount, currency, organizer_net,
    promo_code, promo_discount,
    payment_channel, status, paid_at
  ) VALUES (
    v_order_id, v_mto.event_id, v_org_id,
    v_mto.subtotal,
    COALESCE((v_mto.financial_snapshot->>'tax_rate')::DECIMAL, 0),
    v_mto.tax_amount,
    COALESCE((v_mto.financial_snapshot->>'platform_fee_pct')::DECIMAL, 0),
    v_mto.platform_fee_total,
    v_mto.total_amount, v_mto.currency, v_mto.organizer_net,
    v_mto.promo_code,
    COALESCE((v_mto.financial_snapshot->>'promo_discount')::DECIMAL, 0),
    'manual', 'paid', now()
  );

  -- ═══ 6. GUEST RETRIEVAL TOKEN ═══
  -- Generates a guest token for ALL manual orders (including authenticated ones)
  -- so they can securely view their tickets without being forced to log in on mobile.
  v_raw_token := gen_random_uuid()::text || '-' || gen_random_uuid()::text;
  PERFORM create_guest_token(v_order_id, v_mto.buyer_email, v_raw_token);

  -- ═══ 7. UPDATE: Manual order status ═══
  UPDATE manual_transfer_orders
  SET status      = 'approved',
      approved_by = v_caller_id,
      approved_at = now(),
      guest_token = v_raw_token,
      updated_at  = now()
  WHERE id = p_manual_order_id;

  -- ═══ 8. CONVERT: Reservation ═══
  IF v_mto.reservation_id IS NOT NULL THEN
    UPDATE reservations SET status = 'converted'
    WHERE id = v_mto.reservation_id;
  END IF;

  -- ═══ 8. INCREMENT: Sold count ═══
  PERFORM increment_sold_count(v_mto.tier_id, v_mto.quantity);

  -- ═══ 9. ACCUMULATE: Commission debt ═══
  PERFORM update_commission_debt(
    v_mto.event_id,
    v_mto.platform_fee_total,
    v_mto.subtotal
  );

  -- ═══ 10. INCREMENT: Promo usage (if applicable) ═══
  IF v_mto.promo_id IS NOT NULL THEN
    BEGIN
      PERFORM increment_promo_usage(v_mto.promo_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'increment_promo_usage failed: %', SQLERRM;
    END;
  END IF;

  -- ═══ SUCCESS ═══
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'ticket_ids', to_jsonb(v_ticket_ids),
    'ticket_count', v_mto.quantity,
    'buyer_name', v_mto.buyer_name,
    'buyer_email', v_mto.buyer_email,
    'event_title', v_event.title,
    'tier_name', v_tier.name,
    'total_amount', v_mto.total_amount,
    'currency', v_mto.currency,
    'payment_method', v_mto.payment_method::TEXT
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 2. Redefine trg_manual_order_notification to always include guest_token fallback link ──
CREATE OR REPLACE FUNCTION trg_manual_order_notification()
RETURNS TRIGGER AS $func$
DECLARE
  v_event RECORD;
  v_tier RECORD;
  v_org RECORD;
  v_vars JSONB;
  v_origin TEXT := 'https://eventsli.com';
  v_order_id UUID;
BEGIN
  -- Read origin from platform_settings
  SELECT value->>'origin' INTO v_origin
  FROM platform_settings
  WHERE key = 'notification_config';
  IF v_origin IS NULL OR v_origin = '' THEN
    v_origin := 'https://eventsli.com';
  END IF;

  -- Get event, tier, and organizer details
  SELECT e.title, e.date, e.venue, e.organizer_id INTO v_event FROM events e WHERE e.id = NEW.event_id;
  SELECT tt.name INTO v_tier FROM ticket_tiers tt WHERE tt.id = NEW.tier_id;
  
  SELECT p.full_name as organizer_name, p.email as organizer_email
    FROM organizers org
    JOIN profiles p ON p.id = org.user_id
    WHERE org.user_id = v_event.organizer_id INTO v_org;

  -- ── CASE 1: AFTER INSERT (status = 'pending_payment') ──
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_payment' THEN
    v_vars := jsonb_build_object(
      'buyer_name', NEW.buyer_name,
      'event_title', v_event.title,
      'tier_name', v_tier.name,
      'quantity', NEW.quantity,
      'total_amount', NEW.total_amount,
      'currency', NEW.currency,
      'payment_method', CASE 
        WHEN NEW.payment_method = 'vodafone_cash' THEN 'Vodafone Cash (Mobile Wallet)'
        WHEN NEW.payment_method = 'instapay' THEN 'InstaPay App'
        WHEN NEW.payment_method = 'bank_transfer' THEN 'Bank Transfer'
        WHEN NEW.payment_method = 'fawry' THEN 'Fawry Payment Reference'
        ELSE 'Manual Transfer'
      END,
      'transfer_destination', NEW.transfer_destination,
      'transfer_reference', NEW.transfer_reference,
      'transfer_instructions', COALESCE(NEW.buyer_notes, '')
    );
    PERFORM notify_manual_order_email('manual_order_created', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars);
  END IF;

  -- ── CASE 2: AFTER UPDATE (status transitions) ──
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    
    -- ── 2a: pending_payment -> pending_approval ──
    IF NEW.status = 'pending_approval' THEN
      v_vars := jsonb_build_object(
        'organizer_name', COALESCE(v_org.organizer_name, 'Organizer'),
        'event_title', v_event.title,
        'buyer_name', NEW.buyer_name,
        'buyer_phone', NEW.buyer_phone,
        'total_amount', NEW.total_amount,
        'currency', NEW.currency,
        'payment_method', NEW.payment_method::text,
        'transfer_reference', NEW.transfer_reference,
        'buyer_notes', COALESCE(NEW.buyer_notes, ''),
        'dashboard_url', v_origin || '/dashboard.html'
      );
      PERFORM notify_manual_order_email('manual_order_pending_approval', v_org.organizer_email, COALESCE(v_org.organizer_name, 'Organizer'), NEW.event_id, v_vars);
    
    -- ── 2b: pending_approval -> approved ──
    ELSIF NEW.status = 'approved' THEN
      SELECT id INTO v_order_id FROM orders WHERE manual_transfer_order_id = NEW.id;

      IF NEW.user_id IS NOT NULL THEN
        -- Authenticated user ticket delivery (now includes guest_token fallback link!)
        v_vars := jsonb_build_object(
          'buyer_name', NEW.buyer_name,
          'event_title', v_event.title,
          'tier_name', v_tier.name,
          'quantity', NEW.quantity,
          'total_amount', NEW.total_amount,
          'currency', NEW.currency,
          'event_date', COALESCE(to_char(v_event.date, 'Day, Month DD, YYYY at HH12:MI AM'), 'TBD'),
          'event_venue', COALESCE(v_event.venue, 'TBD'),
          'order_id', v_order_id::text,
          'ticket_link', v_origin || '/my-tickets.html#guest_token=' || COALESCE(NEW.guest_token, '')
        );
        PERFORM notify_manual_order_email('ticket_delivery_auth', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars, jsonb_build_object('order_id', v_order_id));
      ELSE
        -- Guest ticket delivery
        v_vars := jsonb_build_object(
          'buyer_name', NEW.buyer_name,
          'event_title', v_event.title,
          'tier_name', v_tier.name,
          'quantity', NEW.quantity,
          'total_amount', NEW.total_amount,
          'currency', NEW.currency,
          'event_date', COALESCE(to_char(v_event.date, 'Day, Month DD, YYYY at HH12:MI AM'), 'TBD'),
          'event_venue', COALESCE(v_event.venue, 'TBD'),
          'order_id', v_order_id::text,
          'ticket_link', v_origin || '/my-tickets.html#guest_token=' || COALESCE(NEW.guest_token, '')
        );
        PERFORM notify_manual_order_email('ticket_delivery_guest', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars, jsonb_build_object('order_id', v_order_id));
      END IF;
      
    -- ── 2c: pending_approval/pending_payment -> rejected ──
    ELSIF NEW.status = 'rejected' THEN
      v_vars := jsonb_build_object(
        'buyer_name', NEW.buyer_name,
        'event_title', v_event.title,
        'rejection_reason', COALESCE(NEW.rejection_reason, 'No specific reason provided.'),
        'transfer_reference', NEW.transfer_reference,
        'total_amount', NEW.total_amount,
        'currency', NEW.currency
      );
      PERFORM notify_manual_order_email('manual_order_rejected', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars);
    
    END IF;
  END IF;

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
