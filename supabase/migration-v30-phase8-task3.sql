-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v30 Phase 8 Task 3
-- Ticket Transfer: Secure transfer RPC + audit trail
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates table, function. Idempotent.
--
-- BRD Section 20:
--   "يجب أن يتمكن المشتري من نقل التذكرة لشخص آخر"
--   "يجب إبطال QR القديم وتوليد واحد جديد"
--   "يجب تسجيل عملية النقل في سجل مراجعة"
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: Transfer audit log table ════════════

CREATE TABLE IF NOT EXISTS ticket_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES profiles(id),
  from_name TEXT,
  from_email TEXT,
  to_name TEXT NOT NULL,
  to_email TEXT NOT NULL,
  old_qr_hash TEXT NOT NULL,
  new_qr_hash TEXT NOT NULL,
  transferred_at TIMESTAMPTZ DEFAULT now(),
  transferred_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_ticket ON ticket_transfers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON ticket_transfers(from_user_id);

-- RLS: users can see their own transfers
ALTER TABLE ticket_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own transfers" ON ticket_transfers;
CREATE POLICY "Users see own transfers" ON ticket_transfers
  FOR SELECT USING (
    transferred_by = auth.uid()
    OR from_user_id = auth.uid()
  );


-- ════════════ STEP 2: transfer_ticket RPC ════════════
-- Secure ticket transfer with QR regeneration.
-- Only the ticket owner (user_id) can transfer.
-- Ticket must be valid (not used/cancelled).
-- Old QR is invalidated, new one generated.

CREATE OR REPLACE FUNCTION transfer_ticket(
  p_ticket_id UUID,
  p_new_email TEXT,
  p_new_name TEXT
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_ticket RECORD;
  v_old_qr TEXT;
  v_new_qr TEXT;
  v_event_title TEXT;
  v_tier_name TEXT;
BEGIN
  -- ── VALIDATE INPUTS ──
  IF p_new_email IS NULL OR TRIM(p_new_email) = '' THEN
    RETURN jsonb_build_object('error', 'New attendee email is required');
  END IF;

  IF p_new_name IS NULL OR TRIM(p_new_name) = '' THEN
    RETURN jsonb_build_object('error', 'New attendee name is required');
  END IF;

  -- Basic email validation
  IF p_new_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RETURN jsonb_build_object('error', 'Invalid email format');
  END IF;

  -- ── LOCK AND FETCH TICKET ──
  SELECT t.*, tt.name AS tier_name, tt.event_id, e.title AS event_title
  INTO v_ticket
  FROM tickets t
  JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
  JOIN events e ON e.id = tt.event_id
  WHERE t.id = p_ticket_id
  FOR UPDATE OF t;

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('error', 'Ticket not found');
  END IF;

  -- ── OWNERSHIP CHECK ──
  -- Must be the ticket owner OR the order owner
  IF v_ticket.user_id != v_user_id THEN
    -- Check if user owns the order
    IF NOT EXISTS (
      SELECT 1 FROM orders WHERE id = v_ticket.order_id AND user_id = v_user_id
    ) THEN
      RETURN jsonb_build_object('error', 'You do not own this ticket');
    END IF;
  END IF;

  -- ── STATUS CHECK ──
  IF v_ticket.status NOT IN ('valid') THEN
    RETURN jsonb_build_object(
      'error', 'Only valid (unused) tickets can be transferred',
      'current_status', v_ticket.status
    );
  END IF;

  -- ── CHECK EVENT NOT PASSED ──
  IF v_ticket.event_title IS NOT NULL THEN
    -- Event date check via the joined events table
    PERFORM 1 FROM events
    WHERE id = v_ticket.event_id
      AND date < now();
    IF FOUND THEN
      RETURN jsonb_build_object('error', 'Cannot transfer tickets for past events');
    END IF;
  END IF;

  -- ── SAVE OLD QR ──
  v_old_qr := v_ticket.qr_hash;
  v_tier_name := v_ticket.tier_name;
  v_event_title := v_ticket.event_title;

  -- ── GENERATE NEW QR HASH ──
  -- New unique hash: HMAC-style from ticket_id + new_email + timestamp + random
  v_new_qr := encode(
    digest(
      p_ticket_id::text || '|' || p_new_email || '|' || extract(epoch from now())::text || '|' || gen_random_uuid()::text,
      'sha256'
    ),
    'hex'
  );

  -- ── UPDATE TICKET ──
  UPDATE tickets SET
    qr_hash = v_new_qr,
    attendee_name = TRIM(p_new_name),
    attendee_email = TRIM(LOWER(p_new_email)),
    updated_at = now()
  WHERE id = p_ticket_id;

  -- ── LOG TRANSFER ──
  INSERT INTO ticket_transfers (
    ticket_id, from_user_id, from_name, from_email,
    to_name, to_email, old_qr_hash, new_qr_hash, transferred_by
  ) VALUES (
    p_ticket_id,
    v_user_id,
    COALESCE(v_ticket.attendee_name, ''),
    COALESCE(v_ticket.attendee_email, ''),
    TRIM(p_new_name),
    TRIM(LOWER(p_new_email)),
    v_old_qr,
    v_new_qr,
    v_user_id
  );

  -- ── RETURN ──
  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'event_title', v_event_title,
    'tier_name', v_tier_name,
    'new_attendee', TRIM(p_new_name),
    'new_email', TRIM(LOWER(p_new_email)),
    'new_qr_hash', v_new_qr,
    'message', 'Ticket transferred to ' || TRIM(p_new_name) || ' successfully. Old QR code is now invalid.'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 3: Grants ════════════
GRANT EXECUTE ON FUNCTION transfer_ticket(UUID, TEXT, TEXT) TO authenticated;


-- ════════════ ✅ MIGRATION v30 TASK 3 COMPLETE ════════════
--
-- Created:
--   ✓ ticket_transfers table (audit log)
--   ✓ transfer_ticket(ticket_id, new_email, new_name) → JSONB
--
-- Security:
--   ✓ auth.uid() ownership verification
--   ✓ FOR UPDATE lock on ticket row
--   ✓ Only 'valid' tickets can be transferred
--   ✓ Past events blocked
--   ✓ Old QR hash invalidated
--   ✓ New QR hash = SHA256(ticket_id + email + timestamp + random)
--   ✓ Full audit trail with old/new values
--
-- Test:
--   SELECT transfer_ticket('ticket-uuid', 'friend@email.com', 'Friend Name');
