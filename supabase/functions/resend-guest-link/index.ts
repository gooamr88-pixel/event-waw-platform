// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENTSLI — Resend Guest Ticket Link
// Allows guests to retrieve their ticket access link by email.
// Generates a NEW guest token and sends it via Brevo.
// ═══════════════════════════════════
// Deploy: supabase functions deploy resend-guest-link --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventsli.com';
const BREVO_SENDER_NAME = 'Eventsli';

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    // ── Parse input ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return errorResponse(400, 'Valid email is required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── Rate Limit: 3 resend requests per 10 minutes per IP ──
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`guest-resend:${clientIP}`, 3, 600_000)) {
      return errorResponse(429, 'Too many requests. Please wait 10 minutes before trying again.');
    }

    // Also rate limit per email to prevent abuse
    if (!rateLimit(`guest-resend:${normalizedEmail}`, 2, 600_000)) {
      return errorResponse(429, 'We already sent a link to this email. Please check your inbox and spam folder.');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Find guest orders for this email ──
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, amount, currency, status, created_at, guest_name,
        events!inner ( id, title, venue, date )
      `)
      .eq('guest_email', normalizedEmail)
      .eq('is_guest', true)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(10);

    if (orderError) {
      console.error('Order lookup error:', orderError);
      // Don't reveal error details — security
      return jsonResponse({
        success: true,
        message: 'If tickets exist for this email, you will receive an access link shortly.',
      });
    }

    // Always return success to prevent email enumeration
    if (!orders || orders.length === 0) {
      console.log(`No guest orders found for email: ${normalizedEmail}`);
      return jsonResponse({
        success: true,
        message: 'If tickets exist for this email, you will receive an access link shortly.',
      });
    }

    // ── Generate new guest tokens for each order ──
    const originUrl = Deno.env.get('ALLOWED_ORIGIN') || 'https://eventsli.com';
    const ticketLinks: { eventTitle: string; link: string; date: string; venue: string; amount: number }[] = [];

    for (const order of orders) {
      try {
        const rawToken = crypto.randomUUID() + '-' + crypto.randomUUID();
        await supabase.rpc('create_guest_token', {
          p_order_id: order.id,
          p_email: normalizedEmail,
          p_raw_token: rawToken,
        });

        ticketLinks.push({
          eventTitle: order.events?.title || 'Event',
          link: `${originUrl}/my-tickets.html#guest_token=${rawToken}`,
          date: order.events?.date || '',
          venue: order.events?.venue || '',
          amount: order.amount,
        });
      } catch (tokenErr) {
        console.error(`Failed to create guest token for order ${order.id}:`, tokenErr);
      }
    }

    if (ticketLinks.length === 0) {
      return jsonResponse({
        success: true,
        message: 'If tickets exist for this email, you will receive an access link shortly.',
      });
    }

    // ── Build and send email ──
    if (BREVO_API_KEY) {
      const guestName = orders[0]?.guest_name || '';
      const emailHtml = buildResendEmail(guestName, ticketLinks);

      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
          to: [{ email: normalizedEmail }],
          subject: `🎫 Your Eventsli ticket access link${ticketLinks.length > 1 ? 's' : ''}`,
          htmlContent: emailHtml,
        }),
      });

      console.log(`✉️ Guest ticket resend email sent to ${normalizedEmail} (${ticketLinks.length} orders)`);
    }

    return jsonResponse({
      success: true,
      message: 'If tickets exist for this email, you will receive an access link shortly.',
    });

  } catch (err) {
    console.error('Resend guest link error:', err);
    return errorResponse(500, 'Something went wrong. Please try again later.');
  }
});

// ── Email template for resending guest links ──
function buildResendEmail(
  name: string,
  links: { eventTitle: string; link: string; date: string; venue: string; amount: number }[]
): string {
  const BRAND = {
    color: '#059669',
    colorDark: '#047857',
    bg: '#09090b',
    cardBg: '#18181b',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    textDim: '#71717a',
    border: 'rgba(5,150,105,0.08)',
    borderLight: 'rgba(255,255,255,0.06)',
  };

  const ticketBlocks = links.map((t) => {
    const fDate = t.date
      ? new Date(t.date).toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        })
      : '';

    return `
      <tr><td style="padding:16px;background:${BRAND.bg};border:1px solid ${BRAND.borderLight};border-radius:14px;margin-bottom:12px;">
        <h3 style="margin:0 0 8px;font-size:15px;font-weight:700;color:${BRAND.text};">${t.eventTitle}</h3>
        ${fDate ? `<p style="margin:0 0 4px;font-size:12px;color:${BRAND.textDim};">📅 ${fDate}</p>` : ''}
        ${t.venue ? `<p style="margin:0 0 12px;font-size:12px;color:${BRAND.textDim};">📍 ${t.venue}</p>` : ''}
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:10px;background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});">
            <a href="${t.link}" target="_blank"
              style="display:inline-block;padding:12px 24px;font-size:13px;font-weight:700;color:${BRAND.bg};text-decoration:none;">
              View Tickets & QR Code →
            </a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="height:12px;"></td></tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Eventsli</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};">
    <tr><td align="center" style="padding:48px 24px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:36px;height:36px;background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});border-radius:10px;text-align:center;vertical-align:middle;">
              <span style="font-size:18px;font-weight:800;color:${BRAND.bg};line-height:36px;">W</span>
            </td>
            <td style="padding-left:10px;font-size:18px;font-weight:700;color:${BRAND.color};letter-spacing:-0.5px;">
              Eventsli
            </td>
          </tr></table>
        </td></tr>

        <!-- Content Card -->
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:20px;overflow:hidden;">
            
            <!-- Header -->
            <tr><td style="background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});padding:20px 36px;">
              <span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:${BRAND.bg};text-transform:uppercase;">
                🎫 Ticket Access Link
              </span>
            </td></tr>

            <tr><td style="padding:36px;">
              <p style="margin:0 0 4px;font-size:14px;color:${BRAND.textMuted};">Hi ${name || 'there'},</p>
              <p style="margin:0 0 28px;font-size:14px;color:${BRAND.text};line-height:1.6;">
                You requested access to your guest tickets. Here ${links.length > 1 ? 'are your ticket links' : 'is your ticket link'}:
              </p>
              
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${ticketBlocks}
              </table>

              <!-- Security Notice -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                <tr><td style="padding:16px;background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,.1);border-radius:12px;">
                  <p style="margin:0;font-size:12px;color:${BRAND.textMuted};line-height:1.6;">
                    🔒 <strong style="color:#ef4444;">Security:</strong> These are personal access links — do not share them. 
                    Each link expires in 90 days.
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding-top:32px;">
          <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">
            You received this email because a ticket access link was requested for this address.<br/>
            If you didn't request this, you can safely ignore this email.
          </p>
          <p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">
            © ${new Date().getFullYear()} Eventsli. All rights reserved.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
