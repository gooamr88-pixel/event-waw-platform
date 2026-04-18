-- ──────────── FUNCTION 2: request_organizer_upgrade ────────────
-- Uses := assignment instead of SELECT INTO (Supabase SQL Editor bug)
CREATE OR REPLACE FUNCTION request_organizer_upgrade()
RETURNS void AS $func$
DECLARE
  v_current_role TEXT;
BEGIN
  v_current_role := (SELECT role::TEXT FROM profiles WHERE id = auth.uid());

  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_current_role = 'organizer' OR v_current_role = 'admin' THEN
    RETURN;
  END IF;

  IF v_current_role = 'attendee' THEN
    UPDATE profiles SET role = 'organizer' WHERE id = auth.uid();
  ELSE
    RAISE EXCEPTION 'Cannot upgrade from current role';
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION request_organizer_upgrade() TO authenticated;
