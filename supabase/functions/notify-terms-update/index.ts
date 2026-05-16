// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENTSLI — Notify Terms Update Edge Function
// Sends mass email to all organizers when platform terms are updated.
// BRD Rule 3: Running events are NOT paused, but organizers are notified.
// ═══════════════════════════════════
// Deploy: supabase functions deploy notify-terms-update --no-verify-jwt
// Called by admin when publishing new terms version.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventsli.com';
const BREVO_SENDER_NAME = 'Eventsli';
const BATCH_SIZE = 50; // Brevo max recipients per API call

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // ── Auth: Only admin can trigger this ──
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized', {}, req);

    const adminClient = createAdminClient();

    // Verify caller is admin
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
      return errorResponse(403, 'Only admins can trigger terms notifications', {}, req);
    }

    // ── Parse input ──
    const body = await req.json();
    const { version_code, title, content_hash, content_url } = body;

    if (!version_code || !title || !content_hash) {
      return errorResponse(400, 'version_code, title, and content_hash are required', {}, req);
    }

    // ── Insert or activate the new terms version ──
    // Deactivate all current versions of this type
    await adminClient
      .from('platform_terms_versions')
      .update({ is_current: false })
      .eq('terms_type', 'platform')
      .eq('is_current', true);

    // Insert the new version as current
    const { error: insertErr } = await adminClient
      .from('platform_terms_versions')
      .upsert({
        version_code,
        terms_type: 'platform',
        title,
        content_hash,
        content_url: content_url || '/merchant-agreement.html',
        is_current: true,
        effective_from: new Date().toISOString(),
        created_by: user.id,
      }, { onConflict: 'version_code' });

    if (insertErr) {
      console.error('Failed to insert terms version:', insertErr);
      return errorResponse(500, 'Failed to publish terms version', {}, req);
    }

    // ── Fetch all organizers with email ──
    const { data: organizers, error: orgErr } = await adminClient
      .from('organizers')
      .select('user_id, business_name, profiles!inner(email, full_name)')
      .not('user_id', 'is', null);

    if (orgErr) {
      console.error('Failed to fetch organizers:', orgErr);
      return errorResponse(500, 'Failed to fetch organizer list', {}, req);
    }

    if (!organizers || organizers.length === 0) {
      return jsonResponse({ success: true, notified: 0, message: 'No organizers to notify' });
    }

    // ── Send emails in batches via Brevo ──
    let totalSent = 0;
    let totalFailed = 0;

    for (let i = 0; i < organizers.length; i += BATCH_SIZE) {
      const batch = organizers.slice(i, i + BATCH_SIZE);

      const emailPromises = batch.map(async (org: any) => {
        const email = org.profiles?.email;
        const name = org.profiles?.full_name || org.business_name || 'Organizer';

        if (!email) return;

        try {
          const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': BREVO_API_KEY,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
              to: [{ email, name }],
              subject: `📋 Eventsli Platform Terms Updated — Action Required`,
              htmlContent: buildTermsUpdateEmail(name, version_code, title, content_url),
            }),
          });

          if (response.ok) {
            totalSent++;
          } else {
            totalFailed++;
            console.error(`Failed to email ${email}:`, await response.text());
          }
        } catch (emailErr) {
          totalFailed++;
          console.error(`Email error for ${email}:`, emailErr);
        }
      });

      await Promise.all(emailPromises);

      // Rate limit: small delay between batches
      if (i + BATCH_SIZE < organizers.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`✅ Terms update notification: ${totalSent} sent, ${totalFailed} failed, ${organizers.length} total`);

    return jsonResponse({
      success: true,
      version_code,
      notified: totalSent,
      failed: totalFailed,
      total_organizers: organizers.length,
    });
  } catch (err) {
    console.error('Terms notification error:', err);
    return errorResponse(500, err.message || 'Internal server error', {}, req);
  }
});


/**
 * Build the HTML email body for terms update notification.
 */
function buildTermsUpdateEmail(
  name: string,
  versionCode: string,
  title: string,
  contentUrl: string | null
): string {
  const termsLink = contentUrl
    ? `https://eventsli.com${contentUrl}`
    : 'https://eventsli.com/merchant-agreement.html';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Inter',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;text-align:center">
  <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">📋 Platform Terms Updated</h1>
</td></tr>

<!-- Body -->
<tr><td style="padding:40px">
  <p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 20px">
    Hi <strong>${name}</strong>,
  </p>
  <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px">
    We've updated our platform terms and conditions. The new version
    <strong style="color:#6366f1">${versionCode}</strong>
    ("${title}") is now in effect.
  </p>

  <!-- Alert Box -->
  <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:16px 20px;margin:0 0 24px">
    <p style="color:#92400e;font-size:14px;line-height:1.5;margin:0">
      <strong>⚠️ Action Required:</strong> You must review and accept the new terms
      before you can publish any new events. Your existing published events are
      <strong>not affected</strong> and will continue running normally.
    </p>
  </div>

  <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 28px">
    Please review the updated terms at your earliest convenience:
  </p>

  <!-- CTA Button -->
  <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
  <tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;padding:14px 32px">
    <a href="${termsLink}" style="color:#fff;text-decoration:none;font-size:16px;font-weight:600;display:inline-block">
      Review & Accept New Terms →
    </a>
  </td></tr></table>

  <p style="color:#999;font-size:13px;line-height:1.5;margin:0">
    If you have any questions about the changes, please contact our support team.
  </p>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center">
  <p style="color:#9ca3af;font-size:12px;margin:0">
    © ${new Date().getFullYear()} Eventsli. This is an automated notification.
  </p>
</td></tr>

</table>
</td></tr></table>
</body>
</html>`;
}
