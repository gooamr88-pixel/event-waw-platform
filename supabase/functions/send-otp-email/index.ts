// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Send OTP Email Edge Function (Hardened)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy send-otp-email --no-verify-jwt
//
// Required secrets:
//   supabase secrets set BREVO_API_KEY=xkeysib-...
//   supabase secrets set BREVO_SENDER_EMAIL=your@email.com
//   supabase secrets set BREVO_SENDER_NAME="Event Waw"
//   supabase secrets set ALLOWED_ORIGIN=https://yourdomain.com

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { otpLoginEmail, otpRegisterEmail } from '../_shared/email-templates.ts';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!;
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventwaw.com';
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') || 'Event Waw';
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Authenticate the calling user
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return errorResponse(401, 'Unauthorized');
    }

    // 2. Parse request body — code is NO LONGER accepted from the client
    const { name, type } = await req.json();

    // 3. Generate OTP SERVER-SIDE using the service role (no client involvement)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: otpData, error: otpError } = await adminClient
      .rpc('generate_login_otp_for_user', { p_user_id: user.id });

    if (otpError || !otpData?.[0]) {
      console.error('OTP generation error:', otpError);
      // Check for rate limit
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
      ? otpRegisterEmail(code, name)
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

    return new Response(
      JSON.stringify({ success: true, masked_email: maskedEmail }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Send OTP email error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


// Email templates are now imported from ../_shared/email-templates.ts