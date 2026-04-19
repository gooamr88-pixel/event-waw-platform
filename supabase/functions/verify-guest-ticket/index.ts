// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Verify Guest Ticket Edge Function
// Validates a guest token and returns ticket data for display.
// ═══════════════════════════════════
// Deploy: supabase functions deploy verify-guest-ticket --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // ── Parse input ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { guest_token } = body;

    if (!guest_token || typeof guest_token !== 'string' || guest_token.length < 30) {
      return errorResponse(400, 'Invalid guest token');
    }

    // ── Rate Limit: 10 token verifications per minute per IP ──
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`guest-verify:${clientIP}`, 10, 60_000)) {
      return errorResponse(429, 'Too many requests. Please wait a moment.');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Hash the token (same way it was stored) ──
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(guest_token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // ── Verify token via RPC ──
    const { data: tokenResult, error: tokenError } = await supabase
      .rpc('verify_guest_token', { p_token_hash: tokenHash });

    if (tokenError) {
      console.error('Token verification error:', tokenError);
      return errorResponse(500, 'Failed to verify access link');
    }

    // JSONB return — single object, not array
    if (!tokenResult || !tokenResult.is_valid) {
      return errorResponse(403, 'This access link is invalid or has expired. Please check your email for the correct link.');
    }

    const { order_id, guest_email, guest_name } = tokenResult;

    // ── Fetch order + tickets ──
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, amount, currency, status, created_at, guest_name, guest_email,
        tickets (
          id, qr_hash, status, scanned_at,
          ticket_tiers (
            id, name, price,
            events (
              id, title, cover_image, venue, venue_address, date, status
            )
          )
        )
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return errorResponse(404, 'Order not found');
    }

    return jsonResponse({
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        created_at: order.created_at,
        guest_name: order.guest_name,
        guest_email: order.guest_email,
      },
      tickets: (order.tickets || []).map((t: any) => ({
        id: t.id,
        qr_hash: t.qr_hash,
        status: t.status,
        scanned_at: t.scanned_at,
        tier_name: t.ticket_tiers?.name,
        tier_price: t.ticket_tiers?.price,
        event: t.ticket_tiers?.events ? {
          id: t.ticket_tiers.events.id,
          title: t.ticket_tiers.events.title,
          cover_image: t.ticket_tiers.events.cover_image,
          venue: t.ticket_tiers.events.venue,
          venue_address: t.ticket_tiers.events.venue_address,
          date: t.ticket_tiers.events.date,
        } : null,
      })),
    });

  } catch (err) {
    console.error('Guest ticket verification error:', err);
    return errorResponse(500, err.message || 'Internal server error');
  }
});
