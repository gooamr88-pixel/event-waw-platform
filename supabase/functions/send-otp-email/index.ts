// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Send OTP Email Edge Function (Hardened v3)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy send-otp-email --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { rateLimit } from '../_shared/rate-limit.ts';
import { otpLoginEmail, otpRegisterEmail } from '../_shared/email-templates.ts';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!;
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventwaw.com';
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') || 'Event Waw';

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // 1. Authenticate the calling user
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized');

    // ── Rate Limit: 3 OTP requests per 5 minutes per user ──
    if (!rateLimit(`otp:${user.id}`, 3, 300_000)) {
      return errorResponse(429, 'Too many code requests. Please wait a few minutes.');
    }

    // 2. Parse and validate request body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { name, type } = body;

    // Validate type
    if (type && !['login', 'register'].includes(type)) {
      return errorResponse(400, 'Invalid type — must be "login" or "register"');
    }

    // Sanitize name (prevent injection in email template)
    const safeName = name ? String(name).substring(0, 100).replace(/[<>"'&]/g, '') : '';

    // 3. Generate OTP SERVER-SIDE using the service role (no client involvement)
    const adminClient = createAdminClient();
    const { data: otpData, error: otpError } = await adminClient
      .rpc('generate_login_otp_for_user', { p_user_id: user.id });

    if (otpError || !otpData?.[0]) {
      console.error('OTP generation error:', otpError);
      // Check for rate limit from DB
      if (otpError?.message?.includes('wait')) {
        return errorResponse(429, 'Please wait before requesting a new code');
      }
      return errorResponse(500, 'Failed to generate verification code');
    }

    const code = otpData[0].otp_code;
    const maskedEmail = otpData[0].masked_email;
    const email = otpData[0].user_email || user.email;

    // 4. Build email content based on type
    const isRegistration = type === 'register';
    const subject = `${code} — ${isRegistration ? 'Verify your' : 'Your'} Event Waw ${isRegistration ? 'account' : 'verification code'}`;

    const htmlContent = isRegistration
      ? otpRegisterEmail(code, safeName)
      : otpLoginEmail(code);

    // 5. Send via Brevo
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email }],
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
    console.error('Send OTP email error:', err);
    return errorResponse(500, err.message || 'Internal server error');
  }
});