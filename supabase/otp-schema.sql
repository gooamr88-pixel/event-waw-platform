-- ═══════════════════════════════════
-- EVENT WAW — OTP System (Hardened)
-- PostgreSQL RPC functions for OTP generation & verification
-- ═══════════════════════════════════

-- OTP codes for login verification
-- NOTE: otp_code column REMOVED — plaintext must never be stored
CREATE TABLE IF NOT EXISTS login_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  verified boolean DEFAULT false,
  attempts int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_login_otps_user_id ON login_otps(user_id);
CREATE INDEX IF NOT EXISTS idx_login_otps_expires ON login_otps(expires_at);

-- RLS
ALTER TABLE login_otps ENABLE ROW LEVEL SECURITY;

-- Only service role should interact with OTPs now (via Edge Function)
-- We keep minimal RLS policies for safety
CREATE POLICY "Users can view own OTPs"
  ON login_otps FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own OTPs"
  ON login_otps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own OTPs"
  ON login_otps FOR UPDATE
  USING (auth.uid() = user_id);

-- ══════════════════════════════════
-- RPC: Generate OTP (server-side only)
-- Returns the 6-digit code — this should ONLY be called
-- from Edge Functions using the service role key.
-- The plaintext code is returned but NEVER stored.
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION generate_login_otp()
RETURNS TABLE(otp_code text, masked_email text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_code text;
  v_masked text;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Rate limit: prevent generating more than 1 OTP per 60 seconds
  IF EXISTS (
    SELECT 1 FROM login_otps
    WHERE user_id = v_user_id
    AND verified = false
    AND created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before requesting a new code';
  END IF;

  -- Get user email
  SELECT au.email INTO v_email
  FROM auth.users au WHERE au.id = v_user_id;

  -- Generate 6-digit code
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  -- Invalidate previous unused OTPs
  UPDATE login_otps
  SET verified = true
  WHERE user_id = v_user_id AND verified = false;

  -- Store ONLY the hash — never the plaintext
  INSERT INTO login_otps (user_id, email, code_hash, expires_at)
  VALUES (
    v_user_id,
    v_email,
    encode(digest(v_code, 'sha256'), 'hex'),
    now() + interval '5 minutes'
  );

  -- Mask email for display
  v_masked := left(v_email, 2) || '***@' || split_part(v_email, '@', 2);

  RETURN QUERY SELECT v_code, v_masked;
END;
$$;

-- Server-side variant: generate OTP for a specific user (used by Edge Functions)
CREATE OR REPLACE FUNCTION generate_login_otp_for_user(p_user_id uuid)
RETURNS TABLE(otp_code text, masked_email text, user_email text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_email text;
  v_code text;
  v_masked text;
BEGIN
  -- Rate limit
  IF EXISTS (
    SELECT 1 FROM login_otps
    WHERE user_id = p_user_id
    AND verified = false
    AND created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before requesting a new code';
  END IF;

  SELECT au.email INTO v_email
  FROM auth.users au WHERE au.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  UPDATE login_otps SET verified = true
  WHERE user_id = p_user_id AND verified = false;

  INSERT INTO login_otps (user_id, email, code_hash, expires_at)
  VALUES (
    p_user_id,
    v_email,
    encode(digest(v_code, 'sha256'), 'hex'),
    now() + interval '5 minutes'
  );

  v_masked := left(v_email, 2) || '***@' || split_part(v_email, '@', 2);

  RETURN QUERY SELECT v_code, v_masked, v_email;
END;
$$;

-- ══════════════════════════════════
-- RPC: Verify OTP
-- Takes a 6-digit code and verifies it
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION verify_login_otp(p_code text)
RETURNS TABLE(is_verified boolean, error_message text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_otp record;
  v_code_hash text;
  v_remaining int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Not authenticated'::text;
    RETURN;
  END IF;

  -- Find latest unexpired, unverified OTP
  SELECT * INTO v_otp
  FROM login_otps
  WHERE user_id = v_user_id
    AND verified = false
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp IS NULL THEN
    RETURN QUERY SELECT false, 'No valid code found. Please request a new one.'::text;
    RETURN;
  END IF;

  -- Check max attempts
  IF v_otp.attempts >= 5 THEN
    UPDATE login_otps SET verified = true WHERE id = v_otp.id;
    RETURN QUERY SELECT false, 'Too many attempts. Please request a new code.'::text;
    RETURN;
  END IF;

  -- Increment attempts
  UPDATE login_otps SET attempts = v_otp.attempts + 1 WHERE id = v_otp.id;

  -- Hash submitted code and compare
  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');

  IF v_code_hash != v_otp.code_hash THEN
    v_remaining := 4 - v_otp.attempts;
    RETURN QUERY SELECT false, ('Invalid code. ' || v_remaining || ' attempt(s) remaining.')::text;
    RETURN;
  END IF;

  -- ✅ Verified
  UPDATE login_otps SET verified = true WHERE id = v_otp.id;
  RETURN QUERY SELECT true, null::text;
END;
$$;

-- Cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS void AS $$
BEGIN
  DELETE FROM login_otps WHERE expires_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- MIGRATION: Remove plaintext column if it exists
-- Run this on existing databases
-- ══════════════════════════════════
-- ALTER TABLE login_otps DROP COLUMN IF EXISTS otp_code;
