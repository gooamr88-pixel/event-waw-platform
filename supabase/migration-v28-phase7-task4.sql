-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v28 Phase 7 Task 4
-- Admin Payout Management: RPCs + Admin Query
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Creates/replaces functions only. Idempotent.
--
-- BRD Section 8:
--   "يجب أن يتمكن الأدمن من الموافقة أو رفض طلبات السحب"
--   "يجب تسجيل من قام بالمعالجة ومتى"
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: admin_process_payout RPC ════════════
-- Admin marks a payout as completed, failed, or cancelled.
-- Records who processed it and when.

CREATE OR REPLACE FUNCTION admin_process_payout(
  p_payout_id UUID,
  p_action TEXT,           -- 'completed', 'failed', 'cancelled'
  p_external_ref TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_payout RECORD;
BEGIN
  -- ── Admin check ──
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role NOT IN ('super_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Unauthorized: Admin role required');
  END IF;

  -- ── Validate action ──
  IF p_action NOT IN ('completed', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'Invalid action. Must be: completed, failed, or cancelled');
  END IF;

  -- ── Lock and fetch payout ──
  SELECT * INTO v_payout
  FROM payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF v_payout IS NULL THEN
    RETURN jsonb_build_object('error', 'Payout not found');
  END IF;

  IF v_payout.status NOT IN ('pending', 'processing') THEN
    RETURN jsonb_build_object(
      'error', 'Cannot process payout with status: ' || v_payout.status,
      'current_status', v_payout.status
    );
  END IF;

  -- ── Update payout ──
  UPDATE payouts SET
    status = p_action,
    processed_at = CASE WHEN p_action IN ('completed', 'failed') THEN now() ELSE processed_at END,
    processed_by = v_user_id,
    external_ref = COALESCE(p_external_ref, external_ref),
    notes = COALESCE(p_notes, notes),
    failure_reason = CASE WHEN p_action = 'failed' THEN p_failure_reason ELSE failure_reason END,
    updated_at = now()
  WHERE id = p_payout_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', p_payout_id,
    'new_status', p_action,
    'processed_by', v_user_id,
    'message', 'Payout ' || p_action || ' successfully'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 2: admin_get_all_payouts RPC ════════════
-- Returns all payouts with organizer details for the admin table.

CREATE OR REPLACE FUNCTION admin_get_all_payouts(
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS JSONB AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_result JSONB;
BEGIN
  -- ── Admin check ──
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role NOT IN ('super_admin', 'admin', 'moderator') THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.requested_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      po.id,
      po.net_amount,
      po.gross_amount,
      po.currency,
      po.status,
      po.payout_method,
      po.payout_destination,
      po.requested_at,
      po.processed_at,
      po.failure_reason,
      po.external_ref,
      po.notes,
      p.full_name AS organizer_name,
      p.email AS organizer_email,
      e.title AS event_title,
      proc.full_name AS processed_by_name
    FROM payouts po
    JOIN organizers org ON org.id = po.organizer_id
    JOIN profiles p ON p.id = org.user_id
    LEFT JOIN events e ON e.id = po.event_id
    LEFT JOIN profiles proc ON proc.id = po.processed_by
    WHERE (p_status IS NULL OR po.status = p_status)
    ORDER BY
      CASE po.status
        WHEN 'pending' THEN 1
        WHEN 'processing' THEN 2
        ELSE 3
      END,
      po.requested_at DESC NULLS LAST
    LIMIT p_limit
  ) r;

  RETURN v_result;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ════════════ STEP 3: Grants ════════════
GRANT EXECUTE ON FUNCTION admin_process_payout(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_all_payouts(TEXT, INT) TO authenticated;


-- ════════════ ✅ MIGRATION v28 TASK 4 COMPLETE ════════════
--
-- RPCs created:
--   ✓ admin_process_payout(id, action, ref, notes, reason) → JSONB
--   ✓ admin_get_all_payouts(status_filter, limit) → JSONB array
--
-- Security:
--   ✓ Admin role check inside function
--   ✓ FOR UPDATE lock on payout row
--   ✓ Cannot process already completed/failed payouts
--
-- Test:
--   SELECT admin_get_all_payouts();
--   SELECT admin_process_payout('payout-uuid', 'completed', 'TXN_12345', 'Bank transfer done');
