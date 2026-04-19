// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Create Checkout Edge Function (v4 — Guest + Auth)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy create-checkout --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { isValidUUID, isValidQuantity } from '../_shared/validation.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // ── Parse and validate input ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { tier_id, quantity = 1, is_guest = false } = body;

    if (!isValidUUID(tier_id)) {
      return errorResponse(400, 'tier_id must be a valid UUID');
    }

    const qty = Number(quantity);
    if (!isValidQuantity(qty)) {
      return errorResponse(400, 'Quantity must be an integer between 1 and 10');
    }

    const adminClient = createAdminClient();

    // ════════════════════════════════════════════════
    // GUEST CHECKOUT PATH — No auth required
    // ════════════════════════════════════════════════
    if (is_guest) {
      const { guest_name, guest_email, guest_phone, guest_national_id } = body;

      // ── Validate guest fields ──
      if (!guest_name || typeof guest_name !== 'string' || guest_name.trim().length < 2) {
        return errorResponse(400, 'Full name is required (min 2 characters)');
      }
      if (!guest_email || typeof guest_email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) {
        return errorResponse(400, 'A valid email address is required');
      }
      if (!guest_phone || typeof guest_phone !== 'string' || guest_phone.trim().length < 7) {
        return errorResponse(400, 'A valid phone number is required');
      }
      if (!guest_national_id || typeof guest_national_id !== 'string' || guest_national_id.trim().length < 10) {
        return errorResponse(400, 'A valid National ID is required (min 10 characters)');
      }

      // ── Rate Limit: 3 guest checkout attempts per minute per email ──
      const sanitizedEmail = guest_email.trim().toLowerCase();
      if (!rateLimit(`guest-checkout:${sanitizedEmail}`, 3, 60_000)) {
        return errorResponse(429, 'Too many checkout attempts. Please wait a moment.');
      }

      // ── Create guest reservation (no user_id) ──
      const { data: reservation, error: resError } = await adminClient
        .rpc('create_guest_reservation', {
          p_tier_id: tier_id,
          p_quantity: qty,
        });

      if (resError) {
        console.error('Guest reservation error:', resError.message);
        return errorResponse(400, resError.message);
      }

      if (!reservation) {
        return errorResponse(400, 'Failed to create reservation');
      }

      // JSONB return — single object, not array
      const res = reservation;

      // ── Create Stripe Checkout Session for Guest ──
      const originUrl = req.headers.get('origin') || Deno.env.get('ALLOWED_ORIGIN') || 'https://eventwaw.com';

      const sessionConfig: any = {
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: sanitizedEmail,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${res.event_title} — ${res.tier_name}`,
                description: `${qty}x ticket(s) · Guest: ${guest_name.trim()}`,
              },
              unit_amount: Math.round(res.tier_price * 100),
            },
            quantity: qty,
          },
        ],
        metadata: {
          reservation_id: res.reservation_id,
          user_id: '__GUEST__',  // Sentinel value — webhook uses this to detect guest orders
          event_id: res.event_id,
          tier_id: tier_id,
          quantity: String(qty),
          is_guest: 'true',
          guest_name: guest_name.trim(),
          guest_email: sanitizedEmail,
          guest_phone: guest_phone.trim(),
          guest_national_id: guest_national_id.trim(),
        },
        success_url: `${originUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}&guest=true`,
        cancel_url: `${originUrl}/event-detail.html?id=${res.event_id}`,
        expires_at: Math.floor(Date.now() / 1000) + 2100, // 35 minutes
      };

      const session = await stripe.checkout.sessions.create(sessionConfig);

      return jsonResponse({
        checkout_url: session.url,
        reservation_id: res.reservation_id,
      });
    }

    // ════════════════════════════════════════════════
    // AUTHENTICATED CHECKOUT PATH — Existing flow
    // ════════════════════════════════════════════════
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized');

    // ── Rate Limit: 5 checkout attempts per minute per user ──
    if (!rateLimit(`checkout:${user.id}`, 5, 60_000)) {
      return errorResponse(429, 'Too many checkout attempts. Please wait a moment.');
    }

    // ── Create atomic reservation (locks the row, checks capacity) ──
    const { data: reservation, error: resError } = await adminClient
      .rpc('create_reservation', {
        p_user_id: user.id,
        p_tier_id: tier_id,
        p_quantity: qty,
      });

    if (resError) {
      console.error('Reservation error:', resError.message);
      return errorResponse(400, resError.message);
    }

    if (!reservation || reservation.length === 0) {
      return errorResponse(400, 'Failed to create reservation');
    }

    const res = reservation[0];

    // ── Check if organizer has Stripe Connect (future-ready) ──
    // When Stripe Connect is active, uncomment this block:
    /*
    const { data: organizer } = await adminClient
      .from('profiles')
      .select('stripe_account_id, stripe_onboarding_complete')
      .eq('id', res.organizer_id)
      .single();

    if (!organizer?.stripe_account_id || !organizer.stripe_onboarding_complete) {
      return errorResponse(400, 'Organizer has not completed payment setup');
    }
    */

    // ── Create Stripe Checkout Session ──
    const originUrl = req.headers.get('origin') || Deno.env.get('ALLOWED_ORIGIN') || 'https://eventwaw.com';

    const sessionConfig: any = {
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${res.event_title} — ${res.tier_name}`,
              description: `${qty}x ticket(s)`,
            },
            unit_amount: Math.round(res.tier_price * 100), // Stripe uses cents
          },
          quantity: qty,
        },
      ],
      metadata: {
        reservation_id: res.reservation_id,
        user_id: user.id,
        event_id: res.event_id,
        tier_id: tier_id,
        quantity: String(qty),
        is_guest: 'false',
      },
      success_url: `${originUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${originUrl}/event-detail.html?id=${res.event_id}`,
      expires_at: Math.floor(Date.now() / 1000) + 2100, // 35 minutes
    };

    // ── Stripe Connect: Route payment to organizer (uncomment when ready) ──
    /*
    sessionConfig.payment_intent_data = {
      application_fee_amount: Math.round((res.tier_price * qty * 0.05 + 1) * 100), // 5% + $1
      transfer_data: {
        destination: organizer.stripe_account_id,
      },
    };
    */

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return jsonResponse({
      checkout_url: session.url,
      reservation_id: res.reservation_id,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    return errorResponse(500, err.message || 'Internal server error');
  }
});
