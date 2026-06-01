// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENTSLI — Create Checkout Edge Function (v5 — Guest + Auth + Seating)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy create-checkout --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { handleCORS, errorResponse, jsonResponse, getSafeRedirectOrigin } from '../_shared/cors.ts';
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
  const limited = enforceRateLimit(ip, req);
  if (limited) return limited;

  try {
    // ── Parse and validate input ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body', {}, req);
    }

    const { tier_id, quantity = 1, is_guest = false, seat_ids, promo_code } = body;

    // Detect assigned-seating mode: seat_ids is an optional array of UUIDs
    const isSeatedCheckout = Array.isArray(seat_ids) && seat_ids.length > 0;

    if (!isValidUUID(tier_id)) {
      return errorResponse(400, 'tier_id must be a valid UUID', {}, req);
    }

    // For seated checkout, quantity is derived from seat_ids length
    const qty = isSeatedCheckout ? seat_ids.length : Number(quantity);
    if (!isValidQuantity(qty)) {
      return errorResponse(400, 'Quantity must be an integer between 1 and 10', {}, req);
    }

    // Validate each seat_id is a proper UUID
    if (isSeatedCheckout) {
      for (const sid of seat_ids) {
        if (!isValidUUID(sid)) {
          return errorResponse(400, 'Each seat_id must be a valid UUID', {}, req);
        }
      }
    }

    const adminClient = createAdminClient();

    // ════════════════════════════════════════════════
    // FINANCIAL BREAKDOWN via server-side RPC
    // BRD: "الضريبة والعمولة يجب أن تُحسب في الخادم"
    // ════════════════════════════════════════════════

    // Look up the tier to get event_id and currency
    const { data: tierLookup } = await adminClient
      .from('ticket_tiers')
      .select('event_id, currency')
      .eq('id', tier_id)
      .single();

    const checkoutCurrency = (tierLookup?.currency || 'usd').toLowerCase();

    // Call calculate_order_breakdown_v3 — returns cents fields for safe integer math
    const { data: breakdown, error: breakdownErr } = await adminClient
      .rpc('calculate_order_breakdown_v3', {
        p_tier_id: tier_id,
        p_quantity: qty,
        p_promo_code: promo_code || null,
      });

    if (breakdownErr || !breakdown) {
      console.error('Breakdown error:', breakdownErr?.message);
      return errorResponse(400, breakdownErr?.message || 'Failed to calculate pricing', {}, req);
    }

    // Extract values from the server-calculated breakdown
    const promoId = breakdown.promo_id || null;
    // FIX 1.2: Use integer cents from the RPC. calculate_order_breakdown_v3
    // computes ROUND(value * 100)::INT in Postgres with exact DECIMAL math.
    // NO JS float fallback — if the RPC doesn't return cents, fail loud.
    const totalCents = breakdown.total_cents;
    const platformFeeCents = breakdown.platform_fee_cents;

    if (totalCents == null || platformFeeCents == null) {
      console.error('CRITICAL: calculate_order_breakdown_v3 did not return cents fields', breakdown);
      return errorResponse(500, 'Pricing calculation error. Please try again.', {}, req);
    }

    // Ensure organizer row exists (auto-heal) so they can request payouts later
    if (breakdown.organizer_id) {
      const { error: orgUpsertErr } = await adminClient.from('organizers')
        .upsert({ user_id: breakdown.organizer_id }, { onConflict: 'user_id' });
      if (orgUpsertErr) {
        console.warn('⚠️ Failed to auto-heal organizer row:', orgUpsertErr.message);
      }
    }

    // Stripe minimum is $0.50 (50 cents)
    if (totalCents > 0 && totalCents < 50) {
      return errorResponse(400, 'Order total is below minimum ($0.50)', {}, req);
    }

    console.log(`💰 Breakdown: subtotal=$${breakdown.subtotal} tax=$${breakdown.tax_amount} fee=$${breakdown.platform_fee_total} total=$${breakdown.total}`);

    // ════════════════════════════════════════════════
    // BRD RULE 4: STRIPE CONNECT GATE
    // Block checkout if organizer hasn't completed Stripe Connect onboarding.
    // Without this, payments go to the platform account instead of the organizer.
    // ════════════════════════════════════════════════
    let organizerStripe: any = null;
    if (totalCents > 0 && breakdown.organizer_id) {
      const { data: orgRow } = await adminClient
        .from('organizers')
        .select('stripe_account_id, stripe_onboarding_complete, manual_payment_methods')
        .eq('user_id', breakdown.organizer_id)
        .maybeSingle();
      organizerStripe = orgRow;

      if (!orgRow?.stripe_account_id || !orgRow?.stripe_onboarding_complete) {
        // Check if organizer has manual methods configured — give a helpful error
        const hasManualMethods = Array.isArray(orgRow?.manual_payment_methods) &&
          orgRow.manual_payment_methods.some((pm: any) => pm.method && pm.destination);

        const message = hasManualMethods
          ? 'Stripe is not configured for this event. Please select a manual payment method (e.g., Vodafone Cash) from the dropdown instead.'
          : 'This event organizer has not completed their payment setup. Ticket purchases are temporarily unavailable.';

        console.warn(`⛔ Checkout blocked: organizer ${breakdown.organizer_id} has not completed Stripe Connect. hasManualMethods=${hasManualMethods}`);
        return errorResponse(403, message, { reason: 'stripe_not_configured', has_manual_methods: hasManualMethods }, req);
      }

      // ── H-14 FIX: Live Stripe API verification ──
      // The DB flag may be stale — verify the account can actually receive payments
      try {
        const account = await stripe.accounts.retrieve(orgRow.stripe_account_id);
        const canReceivePayments = account.charges_enabled && account.payouts_enabled;
        if (!canReceivePayments) {
          console.warn(`⛔ Stripe live check failed: organizer ${breakdown.organizer_id} account ${orgRow.stripe_account_id} charges_enabled=${account.charges_enabled} payouts_enabled=${account.payouts_enabled}`);
          // Auto-correct stale DB flag
          await adminClient.from('organizers')
            .update({ stripe_onboarding_complete: false })
            .eq('user_id', breakdown.organizer_id);

          const hasManualMethods = Array.isArray(orgRow?.manual_payment_methods) &&
            orgRow.manual_payment_methods.some((pm: any) => pm.method && pm.destination);

          const message = hasManualMethods
            ? 'Stripe account is not yet active. Please select a manual payment method (e.g., Vodafone Cash) from the dropdown.'
            : 'This event organizer\'s payment account is not yet active. Ticket purchases are temporarily unavailable.';

          return errorResponse(403, message, { reason: 'stripe_not_active', has_manual_methods: hasManualMethods }, req);
        }
      } catch (stripeErr) {
        console.error(`⚠️ Stripe account verification failed for ${orgRow.stripe_account_id}:`, stripeErr.message);

        const hasManualMethods = Array.isArray(orgRow?.manual_payment_methods) &&
          orgRow.manual_payment_methods.some((pm: any) => pm.method && pm.destination);

        const message = hasManualMethods
          ? 'Unable to process card payment right now. Please select a manual payment method (e.g., Vodafone Cash) from the dropdown.'
          : 'Unable to verify organizer payment account. Please try again later.';

        return errorResponse(hasManualMethods ? 403 : 500, message, { reason: 'stripe_verification_failed', has_manual_methods: hasManualMethods }, req);
      }
    }

    // ════════════════════════════════════════════════
    // BRD RULE: TERMS COMPLIANCE GATE
    // Block checkout if organizer hasn't accepted current platform terms.
    // BRD Rule 3: Only affects new transactions, not existing events.
    // ════════════════════════════════════════════════
    if (totalCents > 0 && breakdown.organizer_id) {
      const { data: compliance, error: compErr } = await adminClient
        .rpc('check_terms_compliance', { p_user_id: breakdown.organizer_id });

      if (!compErr && compliance && compliance.compliant === false) {
        console.warn(`⛔ Checkout blocked: organizer ${breakdown.organizer_id} terms non-compliant: ${compliance.reason}`);
        return errorResponse(403, 'This event organizer has not accepted the current platform terms. Ticket purchases are temporarily unavailable.', {}, req);
      }
    }

    // ════════════════════════════════════════════════
    // GUEST CHECKOUT PATH — No auth required
    // ════════════════════════════════════════════════
    if (is_guest) {
      const { guest_name, guest_email, guest_phone } = body;

      // ── Validate guest fields ──
      if (!guest_name || typeof guest_name !== 'string' || guest_name.trim().length < 2) {
        return errorResponse(400, 'Full name is required (min 2 characters)', {}, req);
      }
      // M8 FIX: Stricter email validation — require proper domain with TLD ≥ 2 chars
      if (!guest_email || typeof guest_email !== 'string' || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(guest_email.trim())) {
        return errorResponse(400, 'A valid email address is required (e.g., user@example.com)', {}, req);
      }
      // M8 FIX: Validate phone contains only digits, spaces, +, -, ()
      if (!guest_phone || typeof guest_phone !== 'string' || guest_phone.trim().length < 7 || !/^[0-9+\-() ]{7,20}$/.test(guest_phone.trim())) {
        return errorResponse(400, 'A valid phone number is required (7-20 digits)', {}, req);
      }


      // ── Rate Limit: 3 guest checkout attempts per minute per email ──
      const sanitizedEmail = guest_email.trim().toLowerCase();
      if (!rateLimit(`guest-checkout:${sanitizedEmail}`, 3, 60_000)) {
        return errorResponse(429, 'Too many checkout attempts. Please wait a moment.', {}, req);
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
          return errorResponse(400, resError.message, {}, req);
        }
        if (!reservation) return errorResponse(400, 'Failed to reserve seats', {}, req);
        res = reservation;
      } else {
        const { data: reservation, error: resError } = await adminClient
          .rpc('create_guest_reservation', {
            p_tier_id: tier_id,
            p_quantity: qty,
          });
        if (resError) {
          console.error('Guest reservation error:', resError.message);
          return errorResponse(400, resError.message, {}, req);
        }
        if (!reservation) return errorResponse(400, 'Failed to create reservation', {}, req);
        res = reservation;
      }

      // ── Create Stripe Checkout Session for Guest ──
      // H1 FIX: Validate origin against CORS allowlist to prevent open-redirect attacks
      const originUrl = getSafeRedirectOrigin(req);

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
              unit_amount: totalCents,  // Server-calculated total (includes tax + fees)
            },
            quantity: 1,  // Total is already multiplied by qty in RPC
          },
        ],
        metadata: {
          reservation_id: res.reservation_id,
          user_id: '__GUEST__',
          event_id: res.event_id,
          tier_id: tier_id,
          quantity: String(qty),
          is_guest: 'true',
          guest_name: guest_name.trim(),
          guest_email: sanitizedEmail,
          guest_phone: guest_phone.trim(),

          ...(isSeatedCheckout ? { seat_ids: JSON.stringify(seat_ids) } : {}),
          ...(promoId ? { promo_id: promoId, promo_code: promo_code } : {}),
          // Financial snapshot for webhook to save to payments table
          subtotal: String(breakdown.subtotal),
          tax_amount: String(breakdown.tax_amount),
          tax_rate: String(breakdown.tax_rate),
          platform_fee_total: String(breakdown.platform_fee_total),
          platform_fee_pct: String(breakdown.platform_fee_pct),
          promo_discount: String(breakdown.promo_discount),
          organizer_net: String(breakdown.organizer_net),
          organizer_id: breakdown.organizer_id || '',
          tax_inclusive: String(breakdown.tax_inclusive || false),
        },
        success_url: `${originUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}&guest=true`,
        cancel_url: `${originUrl}/event-detail.html?id=${res.event_id}`,
      expires_at: Math.floor(Date.now() / 1000) + 1830,  // Stripe minimum: 30min. DB reservation still 10min (webhook handles late-payment refund)
      };

      // ── Stripe Connect: Route payment to organizer ──
      // organizerStripe was pre-fetched and validated above (BRD Rule 4 gate)
      if (organizerStripe?.stripe_account_id && organizerStripe.stripe_onboarding_complete) {
        sessionConfig.payment_intent_data = {
          ...(platformFeeCents > 0 ? { application_fee_amount: platformFeeCents } : {}),
          transfer_data: { destination: organizerStripe.stripe_account_id },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      return jsonResponse({
        checkout_url: session.url,
        reservation_id: res.reservation_id,
        // H3 FIX: Financial breakdown stripped from client response.
        // Sensitive data (margins, fee structure) stays in Stripe metadata only.
        total: breakdown.total,
        currency: checkoutCurrency,
      });
    }

    // ════════════════════════════════════════════════
    // AUTHENTICATED CHECKOUT PATH — Existing flow
    // ════════════════════════════════════════════════
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized', {}, req);

    // ── Rate Limit: 5 checkout attempts per minute per user ──
    if (!rateLimit(`checkout:${user.id}`, 5, 60_000)) {
      return errorResponse(429, 'Too many checkout attempts. Please wait a moment.', {}, req);
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
        return errorResponse(400, resError.message, {}, req);
      }
      if (!reservation) return errorResponse(400, 'Failed to reserve seats', {}, req);
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
        return errorResponse(400, resError.message, {}, req);
      }
      if (!reservation || reservation.length === 0) {
        return errorResponse(400, 'Failed to create reservation', {}, req);
      }
      res = reservation[0];
    }

    // ── Create Stripe Checkout Session ──
    // organizerStripe was pre-fetched and validated above (BRD Rule 4 gate)
    // H1 FIX: Validate origin against CORS allowlist to prevent open-redirect attacks
    const originUrl = getSafeRedirectOrigin(req);

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
            unit_amount: totalCents,  // Server-calculated total
          },
          quantity: 1,  // Total already includes qty
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
        // Financial snapshot for webhook to save to payments table
        subtotal: String(breakdown.subtotal),
        tax_amount: String(breakdown.tax_amount),
        tax_rate: String(breakdown.tax_rate),
        platform_fee_total: String(breakdown.platform_fee_total),
        platform_fee_pct: String(breakdown.platform_fee_pct),
        promo_discount: String(breakdown.promo_discount),
        organizer_net: String(breakdown.organizer_net),
        organizer_id: breakdown.organizer_id || '',
        tax_inclusive: String(breakdown.tax_inclusive || false),
      },
      success_url: `${originUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${originUrl}/event-detail.html?id=${res.event_id}&tier=${tier_id}&qty=${qty}`,
      expires_at: Math.floor(Date.now() / 1000) + 1830,  // Stripe minimum: 30min. DB reservation still 10min (webhook handles late-payment refund)
    };

    // ── Stripe Connect: Route payment to organizer ──
    if (organizerStripe?.stripe_account_id && organizerStripe.stripe_onboarding_complete) {
      sessionConfig.payment_intent_data = {
        ...(platformFeeCents > 0 ? { application_fee_amount: platformFeeCents } : {}),
        transfer_data: { destination: organizerStripe.stripe_account_id },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return jsonResponse({
      checkout_url: session.url,
      reservation_id: res.reservation_id,
      // H3 FIX: Financial breakdown stripped from client response.
      total: breakdown.total,
      currency: checkoutCurrency,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    return errorResponse(500, err.message || 'Internal server error', {}, req);
  }
});
