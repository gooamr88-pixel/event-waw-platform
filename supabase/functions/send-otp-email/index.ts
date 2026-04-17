// ═══════════════════════════════════
// EVENT WAW — Send OTP Email Edge Function
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy send-otp-email --no-verify-jwt
//
// Required secrets:
//   supabase secrets set BREVO_API_KEY=xkeysib-...
//   supabase secrets set BREVO_SENDER_EMAIL=your@email.com
//   supabase secrets set BREVO_SENDER_NAME="Event Waw"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!;
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventwaw.com';
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') || 'Event Waw';
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse request body
    const { email, code, name, type } = await req.json();

    if (!email || !code) {
      return new Response(JSON.stringify({ error: 'email and code are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Build email content based on type
    const isRegistration = type === 'register';
    const subject = `${code} — ${isRegistration ? 'Verify your' : 'Your'} Event Waw ${isRegistration ? 'account' : 'verification code'}`;

    const htmlContent = isRegistration
      ? buildRegistrationEmail(code, name)
      : buildLoginEmail(code);

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
        to: [{ email, name: name || '' }],
        subject,
        htmlContent,
      }),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      console.error('Brevo API error:', errText);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ success: true }),
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

// ── Email Templates ──

function buildLoginEmail(code: string): string {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#09090b;color:#f4f4f5;">
      <div style="text-align:center;margin-bottom:32px;">
        <h1 style="font-size:24px;font-weight:700;color:#D4AF37;margin:0;">Event Waw</h1>
        <p style="color:#71717a;font-size:14px;margin-top:8px;">Login Verification</p>
      </div>
      <div style="background:#18181b;border:1px solid rgba(212,175,55,0.1);border-radius:16px;padding:32px;text-align:center;">
        <p style="color:#a1a1aa;font-size:14px;margin:0 0 16px;">Enter this code to complete your sign-in:</p>
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#D4AF37;padding:16px 0;font-family:monospace;">
          ${code}
        </div>
        <p style="color:#71717a;font-size:12px;margin:16px 0 0;">This code expires in 5 minutes</p>
      </div>
      <p style="color:#71717a;font-size:12px;text-align:center;margin-top:24px;">
        If you didn't request this code, you can safely ignore this email.
      </p>
    </div>
  `;
}

function buildRegistrationEmail(code: string, name?: string): string {
  return `
    <div style="margin:0;padding:0;background:#09090b;font-family:'Helvetica Neue',Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;padding:48px 24px;">
        <div style="text-align:center;margin-bottom:40px;">
          <h1 style="font-size:22px;font-weight:700;color:#D4AF37;margin:0;letter-spacing:-0.5px;">Event Waw</h1>
        </div>
        <div style="background:#18181b;border:1px solid rgba(212,175,55,0.08);border-radius:20px;padding:40px 32px;text-align:center;">
          <div style="width:56px;height:56px;margin:0 auto 20px;background:rgba(212,175,55,0.08);border-radius:50%;display:flex;align-items:center;justify-content:center;">
            <span style="font-size:24px;">✉️</span>
          </div>
          <h2 style="font-size:18px;font-weight:700;color:#f4f4f5;margin:0 0 8px;">Verify your email</h2>
          <p style="color:#a1a1aa;font-size:14px;margin:0 0 28px;line-height:1.6;">Hi${name ? ' ' + name : ''}, use this code to complete your registration:</p>
          <div style="background:#09090b;border:2px solid rgba(212,175,55,0.15);border-radius:14px;padding:20px;margin:0 auto;max-width:260px;">
            <div style="font-size:38px;font-weight:800;letter-spacing:10px;color:#D4AF37;font-family:'Courier New',monospace;">${code}</div>
          </div>
          <p style="color:#71717a;font-size:12px;margin:20px 0 0;">⏱ This code expires in <strong style="color:#a1a1aa;">5 minutes</strong></p>
        </div>
        <div style="text-align:center;margin-top:28px;">
          <p style="color:#52525b;font-size:11px;line-height:1.6;">If you didn't create an account on Event Waw,<br/>you can safely ignore this email.</p>
        </div>
        <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.04);">
          <p style="color:#3f3f46;font-size:10px;">© ${new Date().getFullYear()} Event Waw. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
}
