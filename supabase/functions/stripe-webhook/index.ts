// ═══════════════════════════════════
// EVENT WAW — Stripe Webhook Edge Function
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13?target=deno';
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const hmacSecret = Deno.env.get('HMAC_SECRET')!;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text(); // Raw body for signature verification

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 });
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

    // ── Generate Tickets with QR Hashes ──
    const tickets = [];
    for (let i = 0; i < qty; i++) {
      const nonce = crypto.randomUUID();
      const payload = JSON.stringify({
        ticket_id: crypto.randomUUID(),
        order_id: order.id,
        tier_id,
        nonce,
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
        id: JSON.parse(payload).ticket_id,
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

    console.log(`✅ Order ${order.id} created with ${qty} tickets`);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
