// @ts-nocheck — Deno Edge Function
// ═══════════════════════════════════
// EVENTSLI — Send Notification Edge Function
// Phase 6: BRD Section 16
// ═══════════════════════════════════
// Deploy: supabase functions deploy send-notification --no-verify-jwt
//
// Called by:
//   1. Postgres triggers via pg_net.http_post()
//   2. Cron job (event reminders)
//   3. Admin manual dispatch
//
// Payload:
//   {
//     template_name: 'event_approved',
//     recipients: [{ email, name }],    // OR auto-resolved via event_id
//     variables: { event_title, ... },
//     event_id?: UUID,
//     context?: { order_id, ticket_id }
//   }

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') || 'Eventsli';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventsli.com';
const INTERNAL_SECRET = Deno.env.get('NOTIFICATION_SECRET') || supabaseServiceKey;

serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    // ── Auth: Only service role or internal secret ──
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const serviceKey = supabaseServiceKey.trim();
    const secret = INTERNAL_SECRET.trim();

    let isJwtServiceRole = false;
    try {
      if (token.includes('.')) {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadPart = parts[1];
          const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = atob(base64);
          const payload = JSON.parse(jsonPayload);
          if (payload && payload.role === 'service_role' && payload.ref === 'bmtwdwoibvoewbesohpu') {
            isJwtServiceRole = true;
          }
        }
      }
    } catch (jwtErr) {
      console.warn("Failed to parse incoming token as JWT:", jwtErr);
    }

    if (token !== serviceKey && token !== secret && !isJwtServiceRole) {
      console.warn(`Unauthorized request attempt: Token signature mismatch (token length: ${token.length}, serviceKey length: ${serviceKey.length}, secret length: ${secret.length})`);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body = await req.json();
    const { template_name, recipients: providedRecipients, variables = {}, event_id, context = {} } = body;

    if (!template_name) {
      return new Response(JSON.stringify({ error: 'template_name is required' }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Fetch template ──
    const { data: template, error: tplErr } = await supabase
      .from('email_templates')
      .select('*')
      .eq('name', template_name)
      .eq('is_active', true)
      .single();

    if (tplErr || !template) {
      console.warn(`Template "${template_name}" not found or disabled`);
      return new Response(JSON.stringify({ error: `Template "${template_name}" not found or disabled` }), { status: 404 });
    }

    // ── Resolve recipients ──
    let recipients = providedRecipients || [];

    // If no explicit recipients, resolve based on template category + event_id
    if (recipients.length === 0 && event_id) {
      if (template.category === 'organizer') {
        // Send to the event organizer
        const { data: event } = await supabase
          .from('events')
          .select('organizer_id, profiles!events_organizer_id_fkey(full_name, email)')
          .eq('id', event_id)
          .single();

        if (event?.profiles?.email) {
          recipients = [{ email: event.profiles.email, name: event.profiles.full_name || '' }];
        }
      } else if (template.category === 'buyer' || template.category === 'reminder') {
        // Send to all ticket holders for this event
        const { data: tickets } = await supabase
          .from('tickets')
          .select(`
            id,
            orders (
              user_id, is_guest, guest_name, guest_email
            ),
            ticket_tiers (
              name
            )
          `)
          .eq('ticket_tiers.event_id', event_id)
          .in('status', ['valid', 'used']);

        if (tickets) {
          const emailSet = new Set(); // Dedup by email
          for (const t of tickets) {
            let email = '';
            let name = '';

            if (t.orders?.is_guest) {
              email = t.orders.guest_email || '';
              name = t.orders.guest_name || 'Guest';
            } else if (t.orders?.user_id) {
              const { data: profile } = await supabase
                .from('profiles')
                .select('full_name, email')
                .eq('id', t.orders.user_id)
                .single();
              email = profile?.email || '';
              name = profile?.full_name || '';
            }

            if (email && !emailSet.has(email)) {
              emailSet.add(email);
              recipients.push({
                email,
                name,
                tier_name: t.ticket_tiers?.name || '',
                ticket_id: t.id,
              });
            }
          }
        }
      }
    }

    if (recipients.length === 0) {
      console.warn(`No recipients found for template "${template_name}" (event: ${event_id})`);
      return new Response(JSON.stringify({ sent: 0, error: 'No recipients found' }), { status: 200 });
    }

    // ── Render template ──
    function renderTemplate(templateStr: string, vars: Record<string, string>): string {
      return templateStr.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return vars[key] !== undefined ? String(vars[key]) : match;
      });
    }

    // ── Send to each recipient ──
    let sentCount = 0;
    let failCount = 0;
    const results: any[] = [];

    for (const recipient of recipients) {
      // Merge per-recipient variables (like buyer_name, tier_name)
      const mergedVars = {
        ...variables,
        buyer_name: recipient.name || variables.buyer_name || 'Valued Guest',
        organizer_name: recipient.name || variables.organizer_name || '',
        tier_name: recipient.tier_name || variables.tier_name || '',
      };

      const renderedSubject = renderTemplate(template.subject, mergedVars);
      const renderedBody = renderTemplate(template.body_html, mergedVars);

      // ── Deduplication check ──
      // For reminders: check if we already sent this template for this event to this email
      if (template.category === 'reminder' && event_id) {
        const { data: existing } = await supabase
          .from('email_logs')
          .select('id')
          .eq('template_name', template_name)
          .eq('event_id', event_id)
          .eq('recipient_email', recipient.email)
          .eq('status', 'sent')
          .limit(1);

        if (existing && existing.length > 0) {
          console.log(`⏭️ Skipping duplicate reminder for ${recipient.email} (event: ${event_id})`);
          continue;
        }
      }

      // ── Send via Brevo ──
      let status = 'sent';
      let errorMessage = '';
      let providerMessageId = '';

      try {
        if (!BREVO_API_KEY) {
          throw new Error('BREVO_API_KEY not configured');
        }

        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
            to: [{ email: recipient.email, name: recipient.name || undefined }],
            subject: renderedSubject,
            htmlContent: renderedBody,
          }),
        });

        if (brevoRes.ok) {
          const brevoData = await brevoRes.json();
          providerMessageId = brevoData?.messageId || '';
          sentCount++;
        } else {
          const errBody = await brevoRes.text();
          status = 'failed';
          errorMessage = `Brevo ${brevoRes.status}: ${errBody.substring(0, 200)}`;
          failCount++;
        }
      } catch (sendErr) {
        status = 'failed';
        errorMessage = sendErr.message || 'Send failed';
        failCount++;
      }

      // ── Log to email_logs ──
      try {
        await supabase.from('email_logs').insert({
          template_name,
          recipient_email: recipient.email,
          recipient_name: recipient.name || null,
          event_id: event_id || null,
          order_id: context.order_id || null,
          ticket_id: recipient.ticket_id || context.ticket_id || null,
          subject_rendered: renderedSubject,
          status,
          error_message: errorMessage || null,
          provider_message_id: providerMessageId || null,
        });
      } catch (logErr) {
        console.error('Failed to log email:', logErr);
      }

      results.push({
        email: recipient.email,
        status,
        error: errorMessage || undefined,
      });
    }

    console.log(`📧 ${template_name}: sent=${sentCount}, failed=${failCount}, total=${recipients.length}`);

    return new Response(JSON.stringify({
      sent: sentCount,
      failed: failCount,
      total: recipients.length,
      results,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    console.error('send-notification error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
