-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Admin Role Hierarchy Migration v17
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Does NOT drop tables or data.
-- Adds:
--   • 'super_admin' and 'moderator' to user_role enum
--   • Updated is_admin() to include all admin-level roles
--   • New is_super_admin() helper
--   • Updated admin_set_user_role() with hierarchy enforcement
-- ═══════════════════════════════════════════════════════════════


-- ════════════ PHASE 1: Extend user_role Enum ════════════
-- PostgreSQL enums can safely ADD new values.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'moderator';


-- ════════════ PHASE 2: Helper Functions ════════════

-- is_super_admin(): Only super_admin role
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated, anon;

-- Update is_admin(): super_admin + admin + moderator all count as "admin-level"
-- This keeps backward compatibility with all existing RLS policies
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'moderator')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- get_admin_level(): Returns numeric level for hierarchy comparison
-- super_admin=3, admin=2, moderator=1, others=0
CREATE OR REPLACE FUNCTION get_admin_level(p_role TEXT)
RETURNS INTEGER AS $$
BEGIN
  RETURN CASE p_role
    WHEN 'super_admin' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'moderator' THEN 1
    ELSE 0
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION get_admin_level(TEXT) TO authenticated;


-- ════════════ PHASE 3: Updated admin_set_user_role ════════════
-- Hierarchy enforcement:
--   • super_admin can assign any role
--   • admin can assign attendee, organizer, moderator (NOT admin or super_admin)
--   • moderator cannot change roles at all

CREATE OR REPLACE FUNCTION admin_set_user_role(p_target_user_id UUID, p_new_role TEXT)
RETURNS void AS $func$
DECLARE
  v_caller_role TEXT;
  v_caller_level INTEGER;
  v_target_level INTEGER;
  v_new_level INTEGER;
BEGIN
  -- Get caller's role
  SELECT role::TEXT INTO v_caller_role FROM profiles WHERE id = auth.uid();
  
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin or super_admin role required';
  END IF;

  v_caller_level := get_admin_level(v_caller_role);
  v_new_level := get_admin_level(p_new_role);

  -- Cannot assign a role equal to or higher than your own (unless super_admin)
  IF v_caller_role != 'super_admin' AND v_new_level >= v_caller_level THEN
    RAISE EXCEPTION 'Cannot assign a role equal to or above your own level';
  END IF;

  -- Cannot modify a user with equal or higher role (unless super_admin)
  SELECT get_admin_level(role::TEXT) INTO v_target_level FROM profiles WHERE id = p_target_user_id;
  IF v_caller_role != 'super_admin' AND v_target_level >= v_caller_level THEN
    RAISE EXCEPTION 'Cannot modify a user with equal or higher role';
  END IF;

  -- Cannot change your own role
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  UPDATE profiles SET role = p_new_role::user_role WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PHASE 4: Updated admin_block_user ════════════
-- Moderators cannot block. Admins can't block other admins.

CREATE OR REPLACE FUNCTION admin_block_user(p_target_user_id UUID, p_reason TEXT)
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
    RAISE EXCEPTION 'Cannot block yourself';
  END IF;

  SELECT role::TEXT INTO v_target_role FROM profiles WHERE id = p_target_user_id;
  
  -- Cannot block users at or above your level
  IF get_admin_level(v_target_role) >= get_admin_level(v_caller_role) THEN
    RAISE EXCEPTION 'Cannot block a user with equal or higher role';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Block reason is required';
  END IF;

  UPDATE profiles SET
    is_blocked     = true,
    blocked_at     = NOW(),
    blocked_reason = trim(p_reason)
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ PHASE 5: Update maintenance mode check ════════════
-- Only super_admin can toggle maintenance mode (handled in frontend)
-- All admin-level roles bypass maintenance (already handled by is_admin())


-- ════════════ VERIFICATION ════════════
-- After running, verify with:
--
--   SELECT unnest(enum_range(NULL::user_role));
--   -- Should show: attendee, organizer, admin, super_admin, moderator
--
--   SELECT proname FROM pg_proc WHERE proname IN ('is_super_admin', 'get_admin_level');
--   -- Should return 2 rows
