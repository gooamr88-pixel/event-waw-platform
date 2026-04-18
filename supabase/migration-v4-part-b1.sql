-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Migration v4 — PART B (Run SECOND)
-- All PL/pgSQL functions — run EACH function SEPARATELY if needed
-- ═══════════════════════════════════════════════════════════════


-- ──────────── FUNCTION 1: admin_set_user_role ────────────
CREATE OR REPLACE FUNCTION admin_set_user_role(p_target_user_id UUID, p_new_role TEXT)
RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only admins can change user roles';
  END IF;
  UPDATE profiles SET role = p_new_role::user_role WHERE id = p_target_user_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_set_user_role(UUID, TEXT) TO authenticated;
