// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Stripe Webhook Edge Function (v5 — Guest + Auth + Seating)
// Handles: checkout.session.completed, charge.refunded,
//          checkout.session.expired, charge.dispute.created
// ═══════════════════════════════════
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';
import { ticketConfirmationEmail, guestTicketEmail } from '../_shared/email-templates.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const hmacSecret = Deno.env.get('HMAC_SECRET')!;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@eventwaw.com';
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') || 'Event Waw';

// ── Supported webhook event types ──
const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'charge.refunded',
  'charge.dispute.created',
]);

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text(); // Raw body for signature verification

  let event: any;
 try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('⛔ Webhook signature verification FAILED:', err.message);
    return new Response(
      JSON.stringify({ error: 'Invalid webhook signature' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Log unhandled event types for observability
  if (!HANDLED_EVENTS.has(event.type)) {
    console.log(`ℹ️ Ignoring event type: ${event.type}`);
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ════════════════════════════════════════════════
  // HANDLER: checkout.session.completed
  // ════════════════════════════════════════════════
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const {
      reservation_id,
      user_id,
      event_id,
      tier_id,
      quantity,
      is_guest,
      guest_name,
      guest_email,
      guest_phone,
      guest_national_id,
    } = session.metadata!;

    const qty = parseInt(quantity || '1');
    const isGuest = is_guest === 'true' || user_id === '__GUEST__';

    console.log(`Payment completed: reservation=${reservation_id}, user=${user_id}, guest=${isGuest}`);

    // ── Idempotency Guard ──
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

    // ── Check reservation is still valid ──
    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', reservation_id)
      .single();

    if (resError || !reservation) {
      console.error('Reservation not found:', reservation_id);
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

    // ── Build order row ──
    const orderData: any = {
      event_id,
      reservation_id,
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent,
      amount: (session.amount_total || 0) / 100,
      currency: session.currency || 'usd',
      status: 'paid',
    };

    if (isGuest) {
      // GUEST order: no user_id, store guest info directly
      orderData.user_id = null;
      orderData.is_guest = true;
      orderData.guest_email = guest_email || session.customer_email || '';
      orderData.guest_name = guest_name || '';
      orderData.guest_phone = guest_phone || '';
      orderData.guest_national_id = guest_national_id || '';
    } else {
      // AUTHENTICATED order
      orderData.user_id = user_id;
      orderData.is_guest = false;
    }

    // ── Create Order ──
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert(orderData)
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

    // ── Resolve user info (auth user OR guest metadata) ──
    let userEmail = '';
    let userName = '';

    if (isGuest) {
      userEmail = guest_email || session.customer_email || '';
      userName = guest_name || '';
    } else {
      const { data: { user: userRecord } } = await supabase.auth.admin.getUserById(user_id);
      userEmail = userRecord?.email || session.customer_email || '';
      userName = userRecord?.user_metadata?.full_name || '';
    }

    // ── Generate Tickets with HMAC-SHA256 Signed QR ──
    // IMPORTANT: QR generation is identical for both guest and auth users.
    // The QR payload contains all data needed for verification.
    // For seated events, we inject seat location into the signed payload.

    // ── Pre-fetch seat location data if this is a seated checkout ──
    const seatIdsRaw = session.metadata?.seat_ids;
    let seatLookup: Record<string, { section_key: string; row_label: string; seat_number: string }> = {};
    let orderedSeatIds: string[] = [];

    if (seatIdsRaw) {
      try {
        orderedSeatIds = JSON.parse(seatIdsRaw);
        const { data: seatRows } = await supabase
          .from('seats')
          .select('id, section_key, row_label, seat_number')
          .in('id', orderedSeatIds);

        if (seatRows) {
          for (const s of seatRows) {
            seatLookup[s.id] = {
              section_key: s.section_key,
              row_label: s.row_label,
              seat_number: s.seat_number,
            };
          }
        }
      } catch (e) {
        console.warn('Failed to pre-fetch seat data for QR:', e);
        orderedSeatIds = [];
      }
    }

    const tickets = [];
    for (let i = 0; i < qty; i++) {
      const ticketId = crypto.randomUUID();
      const nonce = crypto.randomUUID();

      // Build the base payload
      const payloadObj: any = {
        v: 2,
        ticket_id: ticketId,
        order_id: order.id,
        event_id,
        user_id: isGuest ? null : user_id,
        tier_id,
        nonce,
        is_guest: isGuest,
        iat: Math.floor(Date.now() / 1000),
      };

      // ── Inject seat location into the signed payload ──
      const seatId = orderedSeatIds[i];
      if (seatId && seatLookup[seatId]) {
        const loc = seatLookup[seatId];
        payloadObj.sec = loc.section_key;
        payloadObj.row = loc.row_label;
        payloadObj.seat = loc.seat_number;
      }

      const payload = JSON.stringify(payloadObj);

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
        user_id: isGuest ? null : user_id,  // NULL for guest tickets
        qr_hash: qrData,
        status: 'valid',
      });
    }

    const { error: ticketError } = await supabase
      .from('tickets')
      .insert(tickets);

    if (ticketError) {
      console.error('CRITICAL: Ticket creation failed:', ticketError);
      // ── Dead-letter: log failure for manual recovery ──
      try {
        await supabase.from('webhook_failures').insert({
          stripe_session_id: session.id,
          order_id: order.id,
          error: JSON.stringify(ticketError),
          payload: JSON.stringify(session.metadata),
        });
      } catch (dlErr) {
        console.error('Failed to log webhook failure:', dlErr);
      }
      // Don't return 500 — return 200 so Stripe doesn't keep retrying
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

    // ── Increment promo code usage ──
    const promoId = session.metadata?.promo_id;
    if (promoId) {
      try {
        await supabase.rpc('increment_promo_usage', { p_promo_id: promoId });
        console.log(`🏷️ Promo ${session.metadata?.promo_code} usage incremented`);
      } catch (promoErr) {
        console.warn('Failed to increment promo usage (non-critical):', promoErr);
      }
    }

    // ── Seated checkout: mark seats as permanently sold ──
    if (seatIdsRaw) {
      try {
        const seatIds = JSON.parse(seatIdsRaw);
        const ticketIds = tickets.map((t: any) => t.id);
        await supabase.rpc('confirm_seats_sold', {
          p_reservation_id: reservation_id,
          p_ticket_ids: ticketIds,
        });
        console.log(`💺 ${seatIds.length} seats marked as sold for reservation ${reservation_id}`);
      } catch (seatErr) {
        console.error('Failed to confirm seats sold (non-critical):', seatErr);
        // Non-critical — seats will remain 'reserved' and can be reconciled
      }
    }

    // ── Guest: Generate secure retrieval token ──
    let guestTicketUrl = '';
    if (isGuest && userEmail) {
      try {
        const rawToken = crypto.randomUUID() + '-' + crypto.randomUUID();
        await supabase.rpc('create_guest_token', {
          p_order_id: order.id,
          p_email: userEmail,
          p_raw_token: rawToken,
        });

        const originUrl = Deno.env.get('ALLOWED_ORIGIN') || 'https://event-waw-platform.vercel.app';
        guestTicketUrl = `${originUrl}/my-tickets.html?guest_token=${rawToken}`;
        console.log(`🔗 Guest ticket URL generated for ${userEmail}`);
      } catch (tokenErr) {
        console.error('Failed to create guest token:', tokenErr);
        // Non-critical — continue
      }
    }

    // ── Send Confirmation Email ──
    if (BREVO_API_KEY && userEmail) {
      try {
        const formattedDate = eventDate
          ? new Date(eventDate).toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric',
              year: 'numeric', hour: 'numeric', minute: '2-digit',
            })
          : 'TBD';

        const emailHtml = isGuest
          ? guestTicketEmail({
              userName,
              eventTitle,
              tierName,
              quantity: qty,
              totalAmount: (session.amount_total || 0) / 100,
              eventVenue,
              eventDate: formattedDate,
              orderId: order.id,
              ticketLink: guestTicketUrl,
            })
          : ticketConfirmationEmail({
              userName,
              eventTitle,
              tierName,
              quantity: qty,
              totalAmount: (session.amount_total || 0) / 100,
              eventVenue,
              eventDate: formattedDate,
              orderId: order.id,
              ticketLink: `https://event-waw-platform.vercel.app/my-tickets.html`,
            });

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
            subject: isGuest
              ? `🎫 Your guest tickets for ${eventTitle} are confirmed!`
              : `🎫 Your tickets for ${eventTitle} are confirmed!`,
            htmlContent: emailHtml,
          }),
        });
        console.log(`✉️ Confirmation email sent to ${userEmail} (guest=${isGuest})`);
      } catch (emailErr) {
        console.error('Failed to send confirmation email:', emailErr);
        // Don't fail the webhook — email is best-effort
      }
    }

    console.log(`✅ Order ${order.id} created with ${qty} tickets (guest=${isGuest})`);
  }

  // ════════════════════════════════════════════════
  // HANDLER: checkout.session.expired
  // Release the reservation immediately instead of waiting for cron
  // ════════════════════════════════════════════════
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const reservationId = session.metadata?.reservation_id;

    if (reservationId) {
      const { error } = await supabase
        .from('reservations')
        .update({ status: 'expired' })
        .eq('id', reservationId)
        .eq('status', 'active'); // Only expire if still active

      if (error) {
        console.error('Failed to expire reservation:', error);
      } else {
        console.log(`⏱️ Reservation ${reservationId} expired (checkout abandoned)`);
      }

      // Release any seats tied to this expired reservation
      const seatIdsRaw = session.metadata?.seat_ids;
      if (seatIdsRaw) {
        try {
          await supabase.rpc('release_seats_for_order', {
            p_reservation_id: reservationId,
          });
          console.log(`💺 Seats released for expired reservation ${reservationId}`);
        } catch (seatErr) {
          console.error('Failed to release seats on expiry:', seatErr);
        }
      }
    }
  }

  // ════════════════════════════════════════════════
  // HANDLER: charge.refunded
  // Cancel tickets and update order status
  // ════════════════════════════════════════════════
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const paymentIntent = charge.payment_intent;

    if (!paymentIntent) {
      console.warn('Refund event missing payment_intent');
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // Find the order by payment intent
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, event_id')
      .eq('stripe_payment_intent', paymentIntent)
      .maybeSingle();

    if (orderErr || !order) {
      console.warn(`No order found for payment_intent ${paymentIntent}`);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // Mark order as refunded
    await supabase
      .from('orders')
      .update({ status: 'refunded' })
      .eq('id', order.id);

    // Cancel all associated tickets
    const { data: cancelledTickets } = await supabase
      .from('tickets')
      .update({ status: 'cancelled' })
      .eq('order_id', order.id)
      .eq('status', 'valid') // Only cancel valid (un-scanned) tickets
      .select('id, ticket_tier_id');

    // Decrement sold_count for affected tiers
    if (cancelledTickets && cancelledTickets.length > 0) {
      // Group by tier
      const tierCounts: Record<string, number> = {};
      for (const t of cancelledTickets) {
        tierCounts[t.ticket_tier_id] = (tierCounts[t.ticket_tier_id] || 0) + 1;
      }
      for (const [tierId, count] of Object.entries(tierCounts)) {
        await supabase.rpc('increment_sold_count', {
          p_tier_id: tierId,
          p_amount: -count, // Negative to decrement
        });
      }
    }

    // Release seats if this was a seated order
    if (order) {
      try {
        const { data: orderDetail } = await supabase
          .from('orders')
          .select('reservation_id')
          .eq('id', order.id)
          .single();
        if (orderDetail?.reservation_id) {
          await supabase.rpc('release_seats_for_order', {
            p_reservation_id: orderDetail.reservation_id,
          });
          console.log(`💺 Seats released for refunded order ${order.id}`);
        }
      } catch (seatErr) {
        console.error('Failed to release seats on refund:', seatErr);
      }
    }

    console.log(`💸 Refund processed: order ${order.id}, ${cancelledTickets?.length || 0} tickets cancelled`);
  }

  // ════════════════════════════════════════════════
  // HANDLER: charge.dispute.created
  // Immediately cancel tickets for disputed charges
  // ════════════════════════════════════════════════
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object;
    const paymentIntent = dispute.payment_intent;

    if (paymentIntent) {
      const { data: order } = await supabase
        .from('orders')
        .select('id')
        .eq('stripe_payment_intent', paymentIntent)
        .maybeSingle();

      if (order) {
        await supabase.from('orders').update({ status: 'refunded' }).eq('id', order.id);
        await supabase.from('tickets').update({ status: 'cancelled' }).eq('order_id', order.id);
        console.warn(`⚠️ DISPUTE: order ${order.id} — tickets cancelled pending resolution`);

        // Log for manual review
        try {
          await supabase.from('webhook_failures').insert({
            stripe_session_id: dispute.id,
            order_id: order.id,
            error: `DISPUTE: ${dispute.reason || 'unknown'}`,
            payload: JSON.stringify({ dispute_id: dispute.id, amount: dispute.amount }),
          });
        } catch (e) {
          console.error('Failed to log dispute:', e);
        }
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
