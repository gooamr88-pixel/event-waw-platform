// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENTSLI — Create Manual Transfer Order
// Allows buyers to place orders for events using manual
// payment methods (Vodafone Cash, InstaPay, Bank Transfer).
// ═══════════════════════════════════
// Deploy: supabase functions deploy create-manual-order --no-verify-jwt
//
// Architecture:
//   1. Accepts both authenticated (JWT) and guest (no JWT) requests
//   2. Validates input and rate-limits by user/IP
//   3. Calls create_manual_transfer_order RPC (which handles
//      reservation, pricing via calculate_order_breakdown_v3,
//      and transfer instruction lookup)
//   4. Returns order details + transfer instructions
//
// Security:
//   - Rate limited: 5 requests per 10 minutes per user/IP
//   - Server-side pricing (same as Stripe path)
//   - Reservation locks inventory (same as Stripe path)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const VALID_METHODS = ['vodafone_cash', 'instapay', 'bank_transfer', 'fawry'];

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse(405, 'Method not allowed', {}, req);
  }

  try {
    // ── Determine if authenticated or guest ──
    const authHeader = req.headers.get('Authorization');
    let userId = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const { user, error: authError } = await authenticateRequest(req);
      if (user) {
        userId = user.id;
      }
      // If auth fails, treat as guest (don't block)
    }

    // ── Rate Limit: 5 orders per 10 minutes ──
    const rateLimitKey = userId
      ? `manual-order:${userId}`
      : `manual-order:ip:${req.headers.get('x-forwarded-for') || 'unknown'}`;

    if (!rateLimit(rateLimitKey, 5, 600_000)) {
      return errorResponse(429, 'Too many order attempts. Please wait a few minutes.', {}, req);
    }

    // ── Parse and Validate Request Body ──
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body', {}, req);
    }

    const {
      tier_id, quantity, payment_method,
      buyer_name, buyer_email, buyer_phone,
      proof_image_url, buyer_notes, promo_code,
      seat_ids,
    } = body;

    // Required fields
    if (!tier_id) return errorResponse(400, 'Missing tier_id', {}, req);
    if (!payment_method) return errorResponse(400, 'Missing payment_method', {}, req);
    if (!buyer_name?.trim()) return errorResponse(400, 'Missing buyer_name', {}, req);
    if (!buyer_email?.trim()) return errorResponse(400, 'Missing buyer_email', {}, req);
    if (!buyer_phone?.trim()) return errorResponse(400, 'Missing buyer_phone', {}, req);

    // Validate payment method
    if (!VALID_METHODS.includes(payment_method)) {
      return errorResponse(400, `Invalid payment method. Must be one of: ${VALID_METHODS.join(', ')}`, {}, req);
    }

    // Validate quantity
    const qty = parseInt(quantity) || 1;
    if (qty < 1 || qty > 10) {
      return errorResponse(400, 'Quantity must be between 1 and 10', {}, req);
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer_email.trim())) {
      return errorResponse(400, 'Invalid email address', {}, req);
    }

    // ── Call the RPC (uses service_role for SECURITY DEFINER) ──
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc('create_manual_transfer_order', {
      p_event_id: body.event_id || null,
      p_tier_id: tier_id,
      p_quantity: qty,
      p_payment_method: payment_method,
      p_buyer_name: buyer_name.trim(),
      p_buyer_email: buyer_email.trim(),
      p_buyer_phone: buyer_phone.trim(),
      p_user_id: userId,
      p_seat_ids: seat_ids || null,
      p_promo_code: promo_code || null,
      p_proof_image_url: proof_image_url || null,
      p_buyer_notes: buyer_notes || null,
    });

    if (error) {
      console.error('create_manual_transfer_order RPC error:', error);
      return errorResponse(500, error.message || 'Failed to create order', {}, req);
    }

    // Check for application-level errors from the RPC
    if (data?.error) {
      const statusCode = data.error.includes('not found') ? 404
        : data.error.includes('not published') ? 400
        : data.error.includes('not accepted') ? 400
        : data.error.includes('Not enough') ? 409
        : 400;
      return errorResponse(statusCode, data.error, {}, req);
    }

    // ── Success ──
    console.log(
      `✅ Manual order created: ${data.order_id} ` +
      `(${payment_method}, ${data.total_amount} ${data.currency}) ` +
      `ref=${data.transfer_reference}`
    );

    return jsonResponse(data, 201, req);

  } catch (err) {
    console.error('create-manual-order error:', err);
    return errorResponse(500, err.message || 'Internal server error', {}, req);
  }
});
