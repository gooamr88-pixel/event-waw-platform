// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Send Password Reset OTP Edge Function
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy send-password-reset-otp --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/auth.ts';
import { rateLimit } from '../_shared/rate-limit.ts';
import { otpPasswordResetEmail } from '../_shared/email-templates.ts';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!;
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventwaw.com';
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') || 'Event Waw';

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

    const { email } = body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return errorResponse(400, 'Valid email address is required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── Rate Limit: 3 reset requests per 10 minutes per email ──
    if (!rateLimit(`pwd-reset:${normalizedEmail}`, 3, 600_000)) {
      return errorResponse(429, 'Too many reset requests. Please wait a few minutes.');
    }

    // 2. Generate OTP SERVER-SIDE using the service role
    const adminClient = createAdminClient();
    const { data: otpData, error: otpError } = await adminClient
      .rpc('generate_password_reset_otp', { p_email: normalizedEmail });

    if (otpError || !otpData?.[0]) {
      console.error('Password reset OTP generation error:', otpError);
      // Don't reveal whether the email exists or not for security
      // But if it's a rate-limit error, tell them
      if (otpError?.message?.includes('wait')) {
        return errorResponse(429, 'Please wait before requesting a new code');
      }
      // For "no account" errors, we still return success to prevent email enumeration
      if (otpError?.message?.includes('No account')) {
        return jsonResponse({ success: true, masked_email: email.substring(0, 2) + '***@' + email.split('@')[1] });
      }
      return errorResponse(500, 'Failed to generate reset code');
    }

    const code = otpData[0].otp_code;
    const maskedEmail = otpData[0].masked_email;
    const userEmail = normalizedEmail;

    // 3. Build email content
    const subject = `${code} — Reset your Event Waw password`;
    const htmlContent = otpPasswordResetEmail(code);

    // 4. Send via Brevo
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: userEmail }],
        subject,
        htmlContent,
      }),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      console.error('Brevo API error:', errText);
      return errorResponse(502, 'Failed to send email');
    }

    return jsonResponse({ success: true, masked_email: maskedEmail });
  } catch (err) {
    console.error('Send password reset OTP error:', err);
    return errorResponse(500, err.message || 'Internal server error');
  }
});
