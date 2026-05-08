-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v18: Final Missing RPCs
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Does NOT drop tables or data.
-- Creates the 3 RPCs referenced in code but not yet defined:
--   • increment_promo_usage  — webhook promo tracking
--   • admin_delete_event     — admin panel event deletion
--   • admin_unblock_user     — admin panel user unblock
-- ═══════════════════════════════════════════════════════════════


-- ════════════ 1. increment_promo_usage ════════════
-- Called by stripe-webhook after successful checkout with promo code.
-- Atomically increments the used_count on a promo code.

CREATE OR REPLACE FUNCTION increment_promo_usage(p_promo_id UUID)
RETURNS void AS $func$
BEGIN
  UPDATE promo_codes
  SET used_count = used_count + 1,
      updated_at = NOW()
  WHERE id = p_promo_id;

  IF NOT FOUND THEN
    RAISE WARNING 'Promo code % not found for usage increment', p_promo_id;
    -- Non-critical: don't raise exception, just warn
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only service_role should call this (from webhook).
-- No GRANT to authenticated/anon needed.


-- ════════════ 2. admin_delete_event ════════════
-- Called by admin-events-all.js for permanent event deletion.
-- Cascades to ticket_tiers, tickets, orders, reservations, venue_maps, seats.
-- Only admin/super_admin can call.

CREATE OR REPLACE FUNCTION admin_delete_event(p_event_id UUID)
RETURNS void AS $func$
DECLARE
  v_caller_role TEXT;
  v_has_paid_orders BOOLEAN;
BEGIN
  -- Auth check
  SELECT role::TEXT INTO v_caller_role FROM profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or super_admin role required';
  END IF;

  -- Safety check: warn if there are paid orders (data loss prevention)
  SELECT EXISTS (
    SELECT 1 FROM orders WHERE event_id = p_event_id AND status = 'paid'
  ) INTO v_has_paid_orders;

  IF v_has_paid_orders THEN
    RAISE WARNING 'Event % has paid orders — deletion will cascade to order/ticket data', p_event_id;
  END IF;

  -- CASCADE handles: ticket_tiers → tickets, orders, reservations, venue_maps → seats
  DELETE FROM events WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_delete_event(UUID) TO authenticated;


-- ════════════ 3. admin_unblock_user ════════════
-- Called by admin-users.js to restore a blocked user.
-- Hierarchy enforcement: cannot unblock users at or above your level.

CREATE OR REPLACE FUNCTION admin_unblock_user(p_target_user_id UUID)
RETURNS void AS $func$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role::TEXT INTO v_caller_role FROM profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or super_admin role required';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot unblock yourself';
  END IF;

  SELECT role::TEXT INTO v_target_role FROM profiles WHERE id = p_target_user_id;

  -- Cannot unblock users at or above your level (except super_admin can unblock anyone)
  IF v_caller_role != 'super_admin' AND get_admin_level(v_target_role) >= get_admin_level(v_caller_role) THEN
    RAISE EXCEPTION 'Cannot unblock a user with equal or higher role';
  END IF;

  UPDATE profiles
  SET is_blocked     = false,
      blocked_at     = NULL,
      blocked_reason = NULL
  WHERE id = p_target_user_id
    AND is_blocked = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found or not currently blocked';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_unblock_user(UUID) TO authenticated;


-- ════════════ ✅ MIGRATION v18 COMPLETE ════════════
--
-- Verification:
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public'
--   AND routine_name IN ('increment_promo_usage', 'admin_delete_event', 'admin_unblock_user');
--   -- Expected: 3 rows
