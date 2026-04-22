-- ═══════════════════════════════════════════════════════════════
-- EVENT WAW — Migration v10: Password Reset OTP System
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- ════════════ 1. Generate Password Reset OTP by Email ════════════
-- This is SECURITY DEFINER and only callable by service_role
-- (no user auth needed — the user forgot their password!)
-- Uses the existing login_otps table.

CREATE OR REPLACE FUNCTION generate_password_reset_otp(p_email text)
RETURNS TABLE(otp_code text, masked_email text, user_id uuid) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user_id uuid; v_email text; v_code text; v_masked text;
BEGIN
  -- Look up user by email
  SELECT au.id, au.email INTO v_user_id, v_email
  FROM auth.users au
  WHERE lower(au.email) = lower(p_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No account found with this email';
  END IF;

  -- Rate limit: 1 OTP per 60 seconds per user
  IF EXISTS (
    SELECT 1 FROM login_otps
    WHERE user_id = v_user_id AND verified = false
    AND created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before requesting a new code';
  END IF;

  -- Generate 6-digit code
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  -- Invalidate any existing unverified OTPs for this user
  UPDATE login_otps SET verified = true WHERE user_id = v_user_id AND verified = false;

  -- Insert new OTP
  INSERT INTO login_otps (user_id, email, code_hash, expires_at)
  VALUES (v_user_id, v_email, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '5 minutes');

  -- Mask email
  v_masked := left(v_email, 2) || '***@' || split_part(v_email, '@', 2);

  RETURN QUERY SELECT v_code, v_masked, v_user_id;
END; $$;

-- ════════════ 2. Verify Password Reset OTP by Email ════════════
-- Returns success status. Only callable by service_role.

CREATE OR REPLACE FUNCTION verify_password_reset_otp(p_email text, p_code text)
RETURNS TABLE(is_verified boolean, error_message text, p_user_id uuid) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user_id uuid; v_otp record; v_code_hash text; v_remaining int;
BEGIN
  -- Look up user by email
  SELECT au.id INTO v_user_id
  FROM auth.users au
  WHERE lower(au.email) = lower(p_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'No account found with this email'::text, null::uuid;
    RETURN;
  END IF;

  -- Find the latest unverified OTP for this user
  SELECT * INTO v_otp
  FROM login_otps
  WHERE login_otps.user_id = v_user_id AND verified = false AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;

  IF v_otp IS NULL THEN
    RETURN QUERY SELECT false, 'No valid code found. Request a new one.'::text, null::uuid;
    RETURN;
  END IF;

  -- Check max attempts
  IF v_otp.attempts >= 5 THEN
    UPDATE login_otps SET verified = true WHERE id = v_otp.id;
    RETURN QUERY SELECT false, 'Too many attempts. Request a new code.'::text, null::uuid;
    RETURN;
  END IF;

  -- Increment attempts
  UPDATE login_otps SET attempts = v_otp.attempts + 1 WHERE id = v_otp.id;

  -- Compare hash
  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');
  IF v_code_hash != v_otp.code_hash THEN
    v_remaining := 4 - v_otp.attempts;
    RETURN QUERY SELECT false, ('Invalid code. ' || v_remaining || ' attempt(s) remaining.')::text, null::uuid;
    RETURN;
  END IF;

  -- Mark as verified
  UPDATE login_otps SET verified = true WHERE id = v_otp.id;
  RETURN QUERY SELECT true, null::text, v_user_id;
END; $$;


-- ════════════ 3. Security: Service Role Only ════════════
-- These functions should NOT be callable by authenticated/anon users
REVOKE EXECUTE ON FUNCTION generate_password_reset_otp(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION verify_password_reset_otp(text, text) FROM authenticated, anon;


-- ════════════ ✅ DONE ════════════
-- Deploy the edge functions next:
--   supabase functions deploy send-password-reset-otp --no-verify-jwt
--   supabase functions deploy verify-password-reset-otp --no-verify-jwt
