// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Verify Password Reset OTP & Update Password
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy verify-password-reset-otp --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/auth.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // 1. Parse and validate request body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { email, code, newPassword } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return errorResponse(400, 'Valid email address is required');
    }
    if (!code || typeof code !== 'string' || code.length !== 6) {
      return errorResponse(400, 'A 6-digit verification code is required');
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return errorResponse(400, 'Password must be at least 8 characters');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── Rate Limit: 5 verification attempts per 10 minutes per email ──
    if (!rateLimit(`pwd-verify:${normalizedEmail}`, 5, 600_000)) {
      return errorResponse(429, 'Too many verification attempts. Please wait a few minutes.');
    }

    const adminClient = createAdminClient();

    // 2. Verify OTP via the DB function
    const { data: verifyData, error: verifyError } = await adminClient
      .rpc('verify_password_reset_otp', { p_email: normalizedEmail, p_code: code });

    if (verifyError) {
      console.error('OTP verification error:', verifyError);
      return errorResponse(500, 'Failed to verify code');
    }

    const result = verifyData?.[0];
    if (!result || !result.is_verified) {
      return errorResponse(400, result?.error_message || 'Invalid or expired code');
    }

    const userId = result.p_user_id;

    // 3. Update the user's password using the admin client
    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      console.error('Password update error:', updateError);
      return errorResponse(500, 'Failed to update password. Please try again.');
    }

    return jsonResponse({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Verify password reset OTP error:', err);
    return errorResponse(500, err.message || 'Internal server error');
  }
});
