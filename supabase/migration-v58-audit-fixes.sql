-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v58: Codebase Audit Fixes
-- Date: 2026-06-03
--
-- Fixes multiple critical and high-severity bugs found during audit:
--
--   FIX 1 (C-02): Add 'disputed' to order_status enum
--   FIX 2 (C-03): Add missing indexes on orders table
--   FIX 3 (H-08, H-09): Add CHECK constraints for non-negative values
--   FIX 4 (C-04): Fix get_event_tier_revenue auth bypass (trusts p_organizer_id)
--   FIX 5 (C-01): Fix v57 broken RPCs (wrong table/column names)
--   FIX 6 (C-05): Fix v_res_id extraction for authenticated seated manual orders
--
-- ⚠️ SAFE TO RUN: Idempotent. Uses IF NOT EXISTS / DO blocks with EXCEPTION.
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- FIX 1 (C-02): Add 'disputed' to order_status enum
-- ════════════════════════════════════════════════════════════
-- IF NOT EXISTS ensures idempotency across re-runs.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'disputed';


-- ════════════════════════════════════════════════════════════
-- FIX 2 (C-03): Add missing indexes on orders table
-- ════════════════════════════════════════════════════════════
-- These columns are frequently used in WHERE/JOIN clauses
-- but had no indexes, causing full table scans.

CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent ON orders(stripe_payment_intent);
CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_reservation_id ON orders(reservation_id);


-- ════════════════════════════════════════════════════════════
-- FIX 3 (H-08, H-09): Add CHECK constraints for non-negative values
-- ════════════════════════════════════════════════════════════
-- Prevents negative prices, amounts, and sold counts at the DB level.
-- Each wrapped in DO/EXCEPTION to be idempotent.

DO $$ BEGIN
  ALTER TABLE ticket_tiers ADD CONSTRAINT chk_tier_price_non_negative CHECK (price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT chk_order_amount_non_negative CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ticket_tiers ADD CONSTRAINT chk_sold_count_non_negative CHECK (sold_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- FIX 4 (C-04): Fix get_event_tier_revenue to use auth.uid()
-- ════════════════════════════════════════════════════════════
-- Previously trusted p_organizer_id parameter for authorization,
-- allowing any authenticated user to query any organizer's data.
-- Now verifies that p_organizer_id matches auth.uid() (or caller is admin).

CREATE OR REPLACE FUNCTION get_event_tier_revenue(p_event_id UUID, p_organizer_id UUID)
RETURNS TABLE(tier_id UUID, tier_name TEXT, tier_price NUMERIC, capacity INT, sold BIGINT, revenue NUMERIC, scanned BIGINT) AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  -- SECURITY FIX (C-04): Verify caller identity
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Allow if caller IS the organizer, or if caller is an admin
  IF v_caller_id != p_organizer_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_caller_id AND role IN ('admin', 'super_admin')
    ) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  -- Original authorization: event must belong to the specified organizer
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = p_organizer_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY SELECT tt.id, tt.name::TEXT, tt.price, tt.capacity,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status IN ('valid','scanned'))::BIGINT * tt.price,
    (SELECT COUNT(*) FROM tickets t WHERE t.ticket_tier_id = tt.id AND t.status = 'scanned')::BIGINT
  FROM ticket_tiers tt WHERE tt.event_id = p_event_id ORDER BY tt.sort_order;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- FIX 5 (C-01): Fix v57 broken RPCs
-- ════════════════════════════════════════════════════════════
-- All 3 RPCs in migration-v57-gatekeeper-dashboard.sql had errors:
--   - Referenced `ticket_types` (doesn't exist → `ticket_tiers`)
--   - Referenced `t.ticket_type_id` (→ `t.ticket_tier_id`)
--   - Referenced `t.event_id` on tickets (doesn't exist → JOIN through ticket_tiers)
--   - `manual_admit_ticket` referenced `t.updated_at` (doesn't exist on tickets)
--   - `manual_admit_ticket` used `scan_method` column (doesn't exist → `scan_result` + `source`)


-- ── FIX 5a: get_event_scan_stats ──────────────────────────
-- Fixed: tickets → ticket_tiers JOIN for event filtering
-- Fixed: ticket_types → ticket_tiers, ticket_type_id → ticket_tier_id
-- Fixed: scans JOIN through tickets → ticket_tiers for event_id

CREATE OR REPLACE FUNCTION get_event_scan_stats(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         UUID := auth.uid();
  v_authorized      BOOLEAN := false;
  v_total_tickets   INT;
  v_total_scanned   INT;
  v_unique_admits   INT;
  v_re_entries      INT;
  v_cancelled       INT;
  v_histogram       JSONB;
  v_by_tier         JSONB;
BEGIN
  -- ─── Authorization (unchanged) ───────────────────────────
  IF EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM gate_team
    WHERE event_id = p_event_id
      AND staff_user_id = v_user_id
      AND status = 'active'
      AND role = 'gate_lead'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM profiles WHERE id = v_user_id AND role IN ('super_admin', 'admin', 'moderator')
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('error', 'Not authorized to view stats for this event');
  END IF;

  -- ─── Total tickets (FIX: JOIN ticket_tiers for event_id) ──
  SELECT COUNT(*)
  INTO v_total_tickets
  FROM tickets t
  JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
  WHERE tt.event_id = p_event_id
    AND t.status IN ('valid', 'used');

  -- ─── Cancelled / refunded (FIX: JOIN ticket_tiers for event_id) ──
  SELECT COUNT(*)
  INTO v_cancelled
  FROM tickets t
  JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
  WHERE tt.event_id = p_event_id
    AND t.status IN ('cancelled', 'refunded', 'revoked');

  -- ─── Unique admissions (FIX: JOIN ticket_tiers for event_id) ──
  SELECT COUNT(*)
  INTO v_unique_admits
  FROM tickets t
  JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
  WHERE tt.event_id = p_event_id
    AND t.scan_count > 0
    AND t.status IN ('valid', 'used');

  -- ─── Total scan operations (FIX: JOIN ticket_tiers for event_id) ──
  SELECT COALESCE(SUM(t.scan_count), 0)
  INTO v_total_scanned
  FROM tickets t
  JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
  WHERE tt.event_id = p_event_id
    AND t.status IN ('valid', 'used');

  -- ─── Re-entries ─────────────────────────────────────
  v_re_entries := v_total_scanned - v_unique_admits;
  IF v_re_entries < 0 THEN v_re_entries := 0; END IF;

  -- ─── Hourly histogram (FIX: JOIN scans→tickets→ticket_tiers for event_id) ──
  SELECT COALESCE(jsonb_agg(h_row ORDER BY h_row->>'hour'), '[]'::jsonb)
  INTO v_histogram
  FROM (
    SELECT jsonb_build_object(
      'hour', to_char(date_trunc('hour', s.scanned_at), 'HH24:MI'),
      'count', COUNT(*)
    ) AS h_row
    FROM scans s
    JOIN tickets t ON t.id = s.ticket_id
    JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
    WHERE tt.event_id = p_event_id
      AND s.scanned_at >= NOW() - INTERVAL '24 hours'
    GROUP BY date_trunc('hour', s.scanned_at)
  ) sub;

  -- ─── Per-tier breakdown (FIX: ticket_types→ticket_tiers, ticket_type_id→ticket_tier_id) ──
  SELECT COALESCE(jsonb_agg(tier_row), '[]'::jsonb)
  INTO v_by_tier
  FROM (
    SELECT jsonb_build_object(
      'tier_name', tt.name,
      'total', COUNT(t.id),
      'scanned', COUNT(t.id) FILTER (WHERE t.scan_count > 0),
      'remaining', COUNT(t.id) FILTER (WHERE t.scan_count = 0)
    ) AS tier_row
    FROM tickets t
    JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
    WHERE tt.event_id = p_event_id
      AND t.status IN ('valid', 'used')
    GROUP BY tt.name
    ORDER BY tt.name
  ) sub;

  RETURN jsonb_build_object(
    'total_tickets',     v_total_tickets,
    'total_scans',       v_total_scanned,
    'unique_admissions', v_unique_admits,
    're_entries',        v_re_entries,
    'cancelled',         v_cancelled,
    'tickets_remaining', v_total_tickets - v_unique_admits,
    'admission_rate',    CASE WHEN v_total_tickets > 0
                           THEN ROUND((v_unique_admits::numeric / v_total_tickets) * 100, 1)
                           ELSE 0 END,
    'hourly_histogram',  v_histogram,
    'by_tier',           v_by_tier,
    'fetched_at',        NOW()
  );
END;
$$;


-- ── FIX 5b: manual_admit_ticket ────────────────────────────
-- Fixed: ticket_types → ticket_tiers, ticket_type_id → ticket_tier_id
-- Fixed: t.event_id → tt.event_id (tickets has no event_id)
-- Fixed: Removed updated_at = NOW() (tickets has no updated_at)
-- Fixed: INSERT INTO scans uses correct v55 columns (scan_result, source)
--        instead of non-existent scan_method
-- Fixed: Added scanned_at = COALESCE(scanned_at, NOW()) to ticket UPDATE

CREATE OR REPLACE FUNCTION manual_admit_ticket(
  p_event_id  UUID,
  p_ticket_id UUID,
  p_reason    TEXT DEFAULT 'Manual gate lead override'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_authorized   BOOLEAN := false;
  v_ticket       RECORD;
  v_buyer_name   TEXT;
  v_tier_name    TEXT;
BEGIN
  -- ─── Authorization: gate_lead, organizer, or admin only ──
  IF EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM gate_team
    WHERE event_id = p_event_id
      AND staff_user_id = v_user_id
      AND status = 'active'
      AND role = 'gate_lead'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM profiles WHERE id = v_user_id AND role IN ('super_admin', 'admin', 'moderator')
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only gate leads, organizers, and admins can manually admit tickets'
    );
  END IF;

  -- ─── Fetch ticket (FIX: ticket_tiers, ticket_tier_id, tt.event_id) ──
  SELECT t.*, tt.name AS tier_name,
         COALESCE(p.full_name, o.guest_name, o.guest_email, 'Guest') AS buyer_name
  INTO v_ticket
  FROM tickets t
  LEFT JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
  LEFT JOIN orders o ON o.id = t.order_id
  LEFT JOIN profiles p ON p.id = t.user_id
  WHERE t.id = p_ticket_id AND tt.event_id = p_event_id
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ticket not found for this event'
    );
  END IF;

  -- ─── Status check (allow override on valid/used, reject on cancelled) ──
  IF v_ticket.status IN ('cancelled', 'refunded', 'revoked') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot admit: ticket is %s', v_ticket.status),
      'ticket_status', v_ticket.status
    );
  END IF;

  -- ─── Admit the ticket (FIX: removed updated_at, added scanned_at) ──
  UPDATE tickets
  SET scan_count = scan_count + 1,
      status = CASE
        WHEN max_scans_allowed > 0 AND scan_count + 1 >= max_scans_allowed THEN 'used'
        ELSE status
      END,
      scanned_at = COALESCE(scanned_at, NOW())
  WHERE id = p_ticket_id;

  -- ─── Insert scan record (FIX: use v55 columns — scan_result, source, event_id) ──
  INSERT INTO scans (ticket_id, event_id, scanned_by, scan_result, notes, source)
  VALUES (
    p_ticket_id,
    p_event_id,
    v_user_id,
    'admitted',
    p_reason,
    'manual_override'
  );

  RETURN jsonb_build_object(
    'success',    true,
    'message',    format('Manually admitted: %s', v_ticket.buyer_name),
    'ticket_id',  p_ticket_id,
    'buyer_name', v_ticket.buyer_name,
    'tier_name',  v_ticket.tier_name,
    'scan_count', v_ticket.scan_count + 1,
    'status',     CASE
      WHEN v_ticket.max_scans_allowed > 0
        AND v_ticket.scan_count + 1 >= v_ticket.max_scans_allowed
      THEN 'used' ELSE v_ticket.status END
  );
END;
$$;


-- ── FIX 5c: get_scanner_team_status (unchanged, recreated for safety) ──

CREATE OR REPLACE FUNCTION get_scanner_team_status(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_authorized BOOLEAN := false;
  v_team       JSONB;
BEGIN
  -- ─── Authorization ───────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_user_id
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM gate_team
    WHERE event_id = p_event_id
      AND staff_user_id = v_user_id
      AND status = 'active'
      AND role = 'gate_lead'
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized AND EXISTS (
    SELECT 1 FROM profiles WHERE id = v_user_id AND role IN ('super_admin', 'admin', 'moderator')
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('error', 'Not authorized');
  END IF;

  -- ─── Team roster ────────────────────────────────────
  SELECT COALESCE(jsonb_agg(member_row), '[]'::jsonb)
  INTO v_team
  FROM (
    SELECT jsonb_build_object(
      'id',             gt.id,
      'staff_name',     gt.staff_name,
      'staff_email',    gt.staff_email,
      'role',           gt.role,
      'status',         gt.status,
      'device_id',      gt.device_id,
      'last_active_at', gt.last_active_at,
      'is_online',      (gt.last_active_at IS NOT NULL
                          AND gt.last_active_at > NOW() - INTERVAL '2 minutes'),
      'session',        (
        SELECT jsonb_build_object(
          'session_id',       ss.id,
          'started_at',       ss.started_at,
          'total_scans',      ss.total_scans,
          'successful_scans', ss.successful_scans,
          'rejected_scans',   ss.rejected_scans,
          'is_active',        ss.is_active
        )
        FROM scanner_sessions ss
        WHERE ss.gate_team_id = gt.id
          AND ss.event_id = p_event_id
          AND ss.is_active = true
        ORDER BY ss.started_at DESC
        LIMIT 1
      )
    ) AS member_row
    FROM gate_team gt
    WHERE gt.event_id = p_event_id
      AND gt.status IN ('active', 'invited')
    ORDER BY
      (gt.last_active_at > NOW() - INTERVAL '2 minutes') DESC NULLS LAST,
      gt.role DESC,
      gt.staff_name ASC
  ) sub;

  RETURN jsonb_build_object(
    'team', v_team,
    'total_members', jsonb_array_length(v_team),
    'online_count', (
      SELECT COUNT(*) FROM gate_team
      WHERE event_id = p_event_id
        AND status = 'active'
        AND last_active_at > NOW() - INTERVAL '2 minutes'
    ),
    'fetched_at', NOW()
  );
END;
$$;


-- ════════════════════════════════════════════════════════════
-- FIX 6 (C-05): Fix v_res_id for authenticated seated manual orders
-- ════════════════════════════════════════════════════════════
-- Bug: When p_user_id IS NOT NULL and p_seat_ids IS NOT NULL,
-- reserve_seats() is called but v_res_id is never extracted
-- from the v_reservation JSONB result, causing the order to be
-- inserted with reservation_id = NULL.
--
-- Based on the LATEST version from migration-v56 (M-8 reference fix).
-- Only change: added v_res_id extraction after reserve_seats call.

CREATE OR REPLACE FUNCTION create_manual_transfer_order(
  p_event_id        UUID,
  p_tier_id         UUID,
  p_quantity         INT,
  p_payment_method   TEXT,
  p_buyer_name       TEXT,
  p_buyer_email      TEXT,
  p_buyer_phone      TEXT,
  p_user_id          UUID DEFAULT NULL,
  p_seat_ids         UUID[] DEFAULT NULL,
  p_promo_code       TEXT DEFAULT NULL,
  p_proof_image_url  TEXT DEFAULT NULL,
  p_buyer_notes      TEXT DEFAULT NULL
) RETURNS JSONB AS $func$
DECLARE
  v_breakdown     JSONB;
  v_reservation   JSONB;
  v_res_id        UUID;
  v_order_id      UUID;
  v_reference     TEXT;
  v_org           RECORD;
  v_dest          TEXT;
  v_event         RECORD;
  v_method        manual_payment_method;
BEGIN
  -- ═══ VALIDATION ═══

  IF p_quantity < 1 OR p_quantity > 10 THEN
    RETURN jsonb_build_object('error', 'Quantity must be between 1 and 10');
  END IF;

  -- Validate payment method enum
  BEGIN
    v_method := p_payment_method::manual_payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('error', 'Invalid payment method: ' || p_payment_method);
  END;

  -- Check event exists, is published, and allows manual transfers
  SELECT e.id, e.title, e.organizer_id, e.status, e.listing_type,
         e.accepted_payment_methods, e.date
  INTO v_event
  FROM events e WHERE e.id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  IF v_event.status != 'published' THEN
    RETURN jsonb_build_object('error', 'Event is not published');
  END IF;

  -- Block manual transfers for free events (display_only)
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('error', 'Manual transfers are not available for free events');
  END IF;

  -- ═══ GET ORGANIZER TRANSFER DESTINATION ═══
  SELECT org.manual_payment_methods, org.manual_transfer_instructions
  INTO v_org
  FROM organizers org
  JOIN events e ON e.organizer_id = org.user_id
  WHERE e.id = p_event_id;

  -- Find the matching payment method destination
  IF v_org.manual_payment_methods IS NOT NULL THEN
    SELECT elem->>'destination'
    INTO v_dest
    FROM jsonb_array_elements(v_org.manual_payment_methods) AS elem
    WHERE elem->>'method' = p_payment_method
    LIMIT 1;
  END IF;

  -- Verify this payment method is accepted/configured (support dynamic merging of organizer manual methods)
  IF NOT (p_payment_method = ANY(v_event.accepted_payment_methods)) AND v_dest IS NULL THEN
    RETURN jsonb_build_object('error', 'This payment method is not accepted or configured for this event');
  END IF;

  -- ═══ PRICING: Use the same calculation as Stripe checkout ═══
  v_breakdown := calculate_order_breakdown_v3(p_tier_id, p_quantity, p_promo_code);

  IF v_breakdown IS NULL OR v_breakdown ? 'error' THEN
    RETURN jsonb_build_object('error', COALESCE(v_breakdown->>'error', 'Pricing calculation failed'));
  END IF;

  -- ═══ RESERVE INVENTORY ═══
  -- Use the same reservation system as Stripe checkout
  -- NOTE: Reservation failures (sold out, lock contention) will now
  -- propagate as real exceptions, causing proper transaction rollback.
  IF p_user_id IS NOT NULL THEN
    -- Authenticated reservation
    IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
      SELECT rpc_result INTO v_reservation
      FROM (SELECT reserve_seats(p_user_id, p_seat_ids, p_tier_id) AS rpc_result) x;
      -- C-05 FIX: Extract reservation_id from the JSONB result
      -- Previously v_res_id was never set in this path, causing NULL reservation_id in orders
      v_res_id := (v_reservation->>'reservation_id')::UUID;
    ELSE
      DECLARE
        v_res_row RECORD;
      BEGIN
        SELECT * INTO v_res_row
        FROM create_reservation(p_user_id, p_tier_id, p_quantity);
        v_res_id := v_res_row.reservation_id;
      END;
    END IF;
  ELSE
    -- Guest reservation
    IF p_seat_ids IS NOT NULL AND array_length(p_seat_ids, 1) > 0 THEN
      v_reservation := reserve_guest_seats(p_seat_ids, p_tier_id);
      v_res_id := (v_reservation->>'reservation_id')::UUID;
    ELSE
      v_reservation := create_guest_reservation(p_tier_id, p_quantity);
      v_res_id := (v_reservation->>'reservation_id')::UUID;
    END IF;
  END IF;

  -- ═══ GENERATE UNIQUE REFERENCE CODE ═══
  -- M-8 FIX (from v56): 12 random hex chars (281 trillion possible values)
  v_reference := 'EVT-' ||
    upper(substring(p_event_id::TEXT from 1 for 4)) || '-' ||
    upper(substring(md5(random()::TEXT || clock_timestamp()::TEXT) from 1 for 12));

  -- ═══ INSERT MANUAL TRANSFER ORDER ═══
  INSERT INTO manual_transfer_orders (
    event_id, tier_id, reservation_id, user_id,
    buyer_name, buyer_email, buyer_phone,
    payment_method, quantity,
    unit_price, subtotal, tax_amount, platform_fee_total,
    total_amount, currency, organizer_net,
    financial_snapshot,
    transfer_destination, transfer_reference,
    proof_image_url, buyer_notes,
    seat_ids, promo_id, promo_code,
    status, expires_at
  ) VALUES (
    p_event_id, p_tier_id, v_res_id, p_user_id,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    v_method, p_quantity,
    COALESCE((v_breakdown->>'unit_price')::DECIMAL, 0),
    COALESCE((v_breakdown->>'subtotal')::DECIMAL, 0),
    COALESCE((v_breakdown->>'tax_amount')::DECIMAL, 0),
    COALESCE((v_breakdown->>'platform_fee_total')::DECIMAL, 0),
    COALESCE((v_breakdown->>'total')::DECIMAL, 0),
    COALESCE(v_breakdown->>'currency', 'EGP'),
    COALESCE((v_breakdown->>'organizer_net')::DECIMAL, 0),
    v_breakdown,
    v_dest,
    v_reference,
    p_proof_image_url, p_buyer_notes,
    p_seat_ids,
    NULLIF(v_breakdown->>'promo_id', '')::UUID,
    p_promo_code,
    'pending_payment',
    now() + interval '24 hours'
  ) RETURNING id INTO v_order_id;

  -- ═══ RETURN ═══
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'transfer_reference', v_reference,
    'reservation_id', v_res_id,
    'total_amount', COALESCE((v_breakdown->>'total')::DECIMAL, 0),
    'currency', COALESCE(v_breakdown->>'currency', 'EGP'),
    'transfer_destination', v_dest,
    'transfer_instructions', v_org.manual_transfer_instructions,
    'payment_method', p_payment_method,
    'expires_at', (now() + interval '24 hours'),
    'event_title', v_event.title,
    'breakdown', v_breakdown
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- GRANTS (idempotent)
-- ════════════════════════════════════════════════════════════

-- FIX 4: get_event_tier_revenue
GRANT EXECUTE ON FUNCTION get_event_tier_revenue(UUID, UUID) TO authenticated;

-- FIX 5: v57 RPCs
GRANT EXECUTE ON FUNCTION get_event_scan_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_scanner_team_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION manual_admit_ticket(UUID, UUID, TEXT) TO authenticated;

-- FIX 6: create_manual_transfer_order
GRANT EXECUTE ON FUNCTION create_manual_transfer_order(
  UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], TEXT, TEXT, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION create_manual_transfer_order(
  UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], TEXT, TEXT, TEXT
) TO anon;


-- ════════════════════════════════════════════════════════════
-- ✅ VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════
-- Run these after the migration to confirm all fixes applied:

-- FIX 1: Verify 'disputed' enum value exists
SELECT 'FIX 1: disputed enum' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'disputed'
  ) AS passed;

-- FIX 2: Verify indexes exist
SELECT 'FIX 2: indexes' AS check_name,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE tablename = 'orders'
     AND indexname IN ('idx_orders_stripe_payment_intent', 'idx_orders_event_id', 'idx_orders_reservation_id')
  ) = 3 AS passed;

-- FIX 3: Verify CHECK constraints exist
SELECT 'FIX 3: CHECK constraints' AS check_name,
  (SELECT COUNT(*) FROM pg_constraint
   WHERE conname IN ('chk_tier_price_non_negative', 'chk_order_amount_non_negative', 'chk_sold_count_non_negative')
  ) = 3 AS passed;

-- FIX 4: Verify get_event_tier_revenue contains auth.uid() check
SELECT 'FIX 4: auth.uid() in get_event_tier_revenue' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'get_event_tier_revenue') LIKE '%auth.uid()%' AS passed;

-- FIX 5: Verify get_event_scan_stats uses ticket_tiers (not ticket_types)
SELECT 'FIX 5a: ticket_tiers in get_event_scan_stats' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'get_event_scan_stats') NOT LIKE '%ticket_types%' AS passed;

-- FIX 5: Verify manual_admit_ticket uses scan_result (not scan_method)
SELECT 'FIX 5b: scan_result in manual_admit_ticket' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'manual_admit_ticket') NOT LIKE '%scan_method%' AS passed;

-- FIX 6: Verify create_manual_transfer_order extracts v_res_id for seated path
SELECT 'FIX 6: v_res_id extraction in create_manual_transfer_order' AS check_name,
  (SELECT prosrc FROM pg_proc WHERE proname = 'create_manual_transfer_order')
    LIKE '%v_res_id := (v_reservation%reservation_id%' AS passed;

-- ════════════════════════════════════════════════════════════
-- ✅ MIGRATION v58 COMPLETE
-- ════════════════════════════════════════════════════════════
