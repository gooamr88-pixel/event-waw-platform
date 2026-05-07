// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Create Checkout Edge Function (v5 — Guest + Auth + Seating)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy create-checkout --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { isValidUUID, isValidQuantity } from '../_shared/validation.ts';
import { rateLimit, enforceRateLimit } from '../_shared/rate-limit.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  // Usage at top of handler:
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit(ip);
  if (limited) return limited;

  try {
    // ── Parse and validate input ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { tier_id, quantity = 1, is_guest = false, seat_ids, promo_code } = body;

    // Detect assigned-seating mode: seat_ids is an optional array of UUIDs
    const isSeatedCheckout = Array.isArray(seat_ids) && seat_ids.length > 0;

    if (!isValidUUID(tier_id)) {
      return errorResponse(400, 'tier_id must be a valid UUID');
    }

    // For seated checkout, quantity is derived from seat_ids length
    const qty = isSeatedCheckout ? seat_ids.length : Number(quantity);
    if (!isValidQuantity(qty)) {
      return errorResponse(400, 'Quantity must be an integer between 1 and 10');
    }

    // Validate each seat_id is a proper UUID
    if (isSeatedCheckout) {
      for (const sid of seat_ids) {
        if (!isValidUUID(sid)) {
          return errorResponse(400, 'Each seat_id must be a valid UUID');
        }
      }
    }

    const adminClient = createAdminClient();

    // ════════════════════════════════════════════════
    // PROMO CODE VALIDATION (applies to both guest & auth)
    // ════════════════════════════════════════════════
    let promoDiscount = 0; // percentage discount (0-100) or fixed amount
    let promoDiscountType = 'percentage';
    let promoId: string | null = null;

    // Look up the tier to get event_id and currency globally
    const { data: tierLookup } = await adminClient
      .from('ticket_tiers')
      .select('event_id, currency')
      .eq('id', tier_id)
      .single();

    const checkoutCurrency = (tierLookup?.currency || 'usd').toLowerCase();

    if (promo_code && typeof promo_code === 'string' && tierLookup) {
      const { data: promo } = await adminClient
        .from('promo_codes')
        .select('*')
        .eq('code', promo_code.trim().toUpperCase())
        .or(`event_id.eq.${tierLookup.event_id},event_id.is.null`)
        .eq('is_active', true)
        .maybeSingle();

        if (promo) {
          const now = new Date();
          const expired = promo.valid_until && new Date(promo.valid_until) < now;
          const maxedOut = promo.max_uses && promo.used_count >= promo.max_uses;

          if (!expired && !maxedOut) {
            promoDiscount = promo.discount_value || 0;
            promoDiscountType = promo.discount_type || 'percentage';
            promoId = promo.id;
            console.log(`🏷️ Promo ${promo.code} applied: ${promoDiscount}${promoDiscountType === 'percentage' ? '%' : '$'} off`);
          }
        }
      }

    // Helper: apply discount to unit price (in cents)
    function applyDiscount(unitAmountCents: number): number {
      if (promoDiscount <= 0) return unitAmountCents;
      if (promoDiscountType === 'fixed') {
        // Fixed discount spread across quantity
        const discountCents = Math.round(promoDiscount * 100 / qty);
        return Math.max(50, unitAmountCents - discountCents); // Stripe minimum $0.50
      }
      // Percentage
      const discounted = unitAmountCents * (1 - promoDiscount / 100);
      return Math.max(50, Math.round(discounted)); // Stripe minimum $0.50
    }

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

      // ── Create guest reservation ──
      // Seated checkout uses reserve_guest_seats(), GA uses create_guest_reservation()
      let res: any;

      if (isSeatedCheckout) {
        const { data: reservation, error: resError } = await adminClient
          .rpc('reserve_guest_seats', {
            p_seat_ids: seat_ids,
            p_tier_id: tier_id,
          });
        if (resError) {
          console.error('Guest seat reservation error:', resError.message);
          return errorResponse(400, resError.message);
        }
        if (!reservation) return errorResponse(400, 'Failed to reserve seats');
        res = reservation;
      } else {
        const { data: reservation, error: resError } = await adminClient
          .rpc('create_guest_reservation', {
            p_tier_id: tier_id,
            p_quantity: qty,
          });
        if (resError) {
          console.error('Guest reservation error:', resError.message);
          return errorResponse(400, resError.message);
        }
        if (!reservation) return errorResponse(400, 'Failed to create reservation');
        res = reservation;
      }

      // ── Create Stripe Checkout Session for Guest ──
      const originUrl = req.headers.get('origin') || Deno.env.get('ALLOWED_ORIGIN') || 'https://eventwaw.com';

      const sessionConfig: any = {
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: sanitizedEmail,
        line_items: [
          {
            price_data: {
              currency: checkoutCurrency,
              product_data: {
                name: `${res.event_title} — ${res.tier_name}`,
                description: `${qty}x ticket(s) · Guest: ${guest_name.trim()}`,
              },
              unit_amount: applyDiscount(Math.round(res.tier_price * 100)),
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
          ...(isSeatedCheckout ? { seat_ids: JSON.stringify(seat_ids) } : {}),
          ...(promoId ? { promo_id: promoId, promo_code: promo_code } : {}),
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

    // ── Create atomic reservation ──
    // Seated checkout uses reserve_seats() with SKIP LOCKED
    // GA checkout uses the existing create_reservation()
    let res: any;

    if (isSeatedCheckout) {
      const { data: reservation, error: resError } = await adminClient
        .rpc('reserve_seats', {
          p_user_id: user.id,
          p_seat_ids: seat_ids,
          p_tier_id: tier_id,
        });
      if (resError) {
        console.error('Seat reservation error:', resError.message);
        return errorResponse(400, resError.message);
      }
      if (!reservation) return errorResponse(400, 'Failed to reserve seats');
      res = reservation;
    } else {
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
      res = reservation[0];
    }

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
            currency: checkoutCurrency,
            product_data: {
              name: `${res.event_title} — ${res.tier_name}`,
              description: `${qty}x ticket(s)`,
            },
            unit_amount: applyDiscount(Math.round(res.tier_price * 100)), // Apply promo discount
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
        ...(isSeatedCheckout ? { seat_ids: JSON.stringify(seat_ids) } : {}),
        ...(promoId ? { promo_id: promoId, promo_code: promo_code } : {}),
      },
      success_url: `${originUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${originUrl}/event-detail.html?id=${res.event_id}&tier=${tier_id}&qty=${qty}`,
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
