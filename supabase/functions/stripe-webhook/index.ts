// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Stripe Webhook Edge Function (Hardened)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';
import { ticketConfirmationEmail } from '../_shared/email-templates.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const hmacSecret = Deno.env.get('HMAC_SECRET')!;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventwaw.com';
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') || 'Event Waw';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text(); // Raw body for signature verification

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('⛔ Webhook signature verification FAILED:', err.message);
    // SECURITY: Never fall back to raw JSON parsing.
    // Use Stripe CLI for local testing: stripe listen --forward-to <url>
    return new Response(
      JSON.stringify({ error: 'Invalid webhook signature' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const {
      reservation_id,
      user_id,
      event_id,
      tier_id,
      quantity,
    } = session.metadata!;

    const qty = parseInt(quantity || '1');

    console.log(`Payment completed: reservation=${reservation_id}, user=${user_id}`);

    // ── Idempotency Guard ──
    // Prevent duplicate processing if Stripe retries the webhook
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_session_id', session.id)
      .maybeSingle();

    if (existingOrder) {
      console.log(`Order already exists for session ${session.id}, skipping duplicate`);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check reservation is still valid
    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', reservation_id)
      .single();

    if (resError || !reservation) {
      console.error('Reservation not found:', reservation_id);
      // Refund immediately
      if (session.payment_intent) {
        await stripe.refunds.create({ payment_intent: session.payment_intent as string });
      }
      return new Response(JSON.stringify({ error: 'Reservation not found, refund issued' }), { status: 200 });
    }

    if (reservation.status === 'expired') {
      console.warn('Reservation expired, issuing refund');
      if (session.payment_intent) {
        await stripe.refunds.create({ payment_intent: session.payment_intent as string });
      }
      return new Response(JSON.stringify({ error: 'Reservation expired, refund issued' }), { status: 200 });
    }

    // ── Create Order ──
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id,
        event_id,
        reservation_id,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent,
        amount: (session.amount_total || 0) / 100, // Convert from cents
        currency: session.currency || 'egp',
        status: 'paid',
      })
      .select()
      .single();

    if (orderError) {
      console.error('Error creating order:', orderError);
      return new Response(JSON.stringify({ error: 'Failed to create order' }), { status: 500 });
    }

    // ── Fetch event + tier details for ticket/email ──
    const { data: tierInfo } = await supabase
      .from('ticket_tiers')
      .select('name, price, events(id, title, venue, date, cover_image)')
      .eq('id', tier_id)
      .single();

    const eventTitle = tierInfo?.events?.title || 'Event';
    const tierName = tierInfo?.name || 'General';
    const eventVenue = tierInfo?.events?.venue || '';
    const eventDate = tierInfo?.events?.date || '';

    // ── Fetch user email ──
    const { data: { user: userRecord } } = await supabase.auth.admin.getUserById(user_id);
    const userEmail = userRecord?.email || session.customer_email || '';
    const userName = userRecord?.user_metadata?.full_name || '';

    // ── Generate Tickets with HMAC-SHA256 Signed QR ──
    const tickets = [];
    for (let i = 0; i < qty; i++) {
      const ticketId = crypto.randomUUID();
      const nonce = crypto.randomUUID();

      // Enhanced payload with event/user context + version
      const payload = JSON.stringify({
        v: 2,
        ticket_id: ticketId,
        order_id: order.id,
        event_id,
        user_id,
        tier_id,
        nonce,
        iat: Math.floor(Date.now() / 1000),
      });

      // HMAC-SHA256 signature
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(hmacSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
      const hash = base64url(new Uint8Array(sig));

      const qrData = JSON.stringify({
        ...JSON.parse(payload),
        hash,
      });

      tickets.push({
        id: ticketId,
        order_id: order.id,
        ticket_tier_id: tier_id,
        user_id,
        qr_hash: qrData,
        status: 'valid',
      });
    }

    const { error: ticketError } = await supabase
      .from('tickets')
      .insert(tickets);

    if (ticketError) {
      console.error('Error creating tickets:', ticketError);
    }

    // ── Mark reservation as converted ──
    await supabase
      .from('reservations')
      .update({ status: 'converted' })
      .eq('id', reservation_id);

    // ── Update sold_count (denormalized cache) ──
    await supabase.rpc('increment_sold_count', {
      p_tier_id: tier_id,
      p_amount: qty,
    });

    // ── Send Confirmation Email ──
    if (BREVO_API_KEY && userEmail) {
      try {
        const formattedDate = eventDate
          ? new Date(eventDate).toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric',
              year: 'numeric', hour: 'numeric', minute: '2-digit',
            })
          : 'TBD';

        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
            to: [{ email: userEmail }],
            subject: `🎫 Your tickets for ${eventTitle} are confirmed!`,
            htmlContent: ticketConfirmationEmail({
              userName,
              eventTitle,
              tierName,
              quantity: qty,
              totalAmount: (session.amount_total || 0) / 100,
              eventVenue,
              eventDate: formattedDate,
              orderId: order.id,
              ticketLink: `https://eventwaw.com/my-tickets.html`,
            }),
          }),
        });
        console.log(`✉️ Confirmation email sent to ${userEmail}`);
      } catch (emailErr) {
        console.error('Failed to send confirmation email:', emailErr);
        // Don't fail the webhook — email is best-effort
      }
    }

    console.log(`✅ Order ${order.id} created with ${qty} tickets`);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});


// Email templates are now imported from ../_shared/email-templates.ts
