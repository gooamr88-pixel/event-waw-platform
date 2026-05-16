// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENTSLI — Verify Ticket Edge Function (Hardened v3)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy verify-ticket --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { isValidUUID } from '../_shared/validation.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const hmacSecret = Deno.env.get('HMAC_SECRET')!;

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // ── Authenticate the scanner user ──
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized', {}, req);

    // ── Rate Limit: 30 scans per minute per user ──
    if (!rateLimit(`verify:${user.id}`, 30, 60_000)) {
      return errorResponse(429, 'Too many scan attempts. Please slow down.', {}, req);
    }

    // ── Parse request body ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body', {}, req);
    }

    const { qr_payload } = body;
    if (!qr_payload || typeof qr_payload !== 'string') {
      return errorResponse(400, 'qr_payload is required and must be a string', {}, req);
    }

    // Limit payload size to prevent abuse (max 2KB)
    if (qr_payload.length > 2048) {
      return errorResponse(400, 'QR payload too large', {}, req);
    }

    // ── Parse QR payload ──
    let parsed;
    try {
      parsed = JSON.parse(qr_payload);
    } catch {
      return errorResponse(400, 'Invalid QR code format', {}, req);
    }

    const { ticket_id, order_id, tier_id, nonce, hash, v, event_id: qr_event_id, user_id: qr_user_id, iat, is_guest: qr_is_guest, sec: qr_sec, row: qr_row, seat: qr_seat } = parsed;
    if (!ticket_id || !order_id || !hash) {
      return errorResponse(400, 'Malformed ticket data', {}, req);
    }

    // ── Validate UUIDs ──
    if (!isValidUUID(ticket_id) || !isValidUUID(order_id)) {
      return errorResponse(400, 'Invalid ticket identifiers', {}, req);
    }

    // ── Verify HMAC signature — support both v1 and v2 payload formats ──
    let payload: string;
    if (v === 2) {
      // Build the payload object in the same order as the webhook generated it
      const payloadObj: any = { v: 2, ticket_id, order_id, event_id: qr_event_id, user_id: qr_user_id, tier_id, nonce, is_guest: qr_is_guest, iat };
      // Seat fields are only present for seated tickets
      if (qr_sec !== undefined) payloadObj.sec = qr_sec;
      if (qr_row !== undefined) payloadObj.row = qr_row;
      if (qr_seat !== undefined) payloadObj.seat = qr_seat;
      payload = JSON.stringify(payloadObj);
    } else {
      payload = JSON.stringify({ ticket_id, order_id, tier_id, nonce });
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(hmacSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const expectedSig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const expectedHash = base64url(new Uint8Array(expectedSig));

    if (hash !== expectedHash) {
      console.warn(`⛔ Forgery attempt by user ${user.id} — hash mismatch`);
      return errorResponse(403, 'Invalid ticket signature — possible forgery', {}, req);
    }

    // ── Call scan_ticket RPC (Phase 5: handles concurrency, limits, logging) ──
    const supabase = createAdminClient();

    // Capture device info from request headers
    const deviceInfo = req.headers.get('user-agent') || 'Unknown device';
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

    // ── Verify scanner is authorized (organizer or admin) + check event expiry ──
    // Combined into single query (was 2 separate identical joins — PERF fix)
    const { data: ticketCheck } = await supabase
      .from('tickets')
      .select(`
        ticket_tiers (
          events ( organizer_id, date )
        )
      `)
      .eq('id', ticket_id)
      .single();

    const eventOrganizerId = ticketCheck?.ticket_tiers?.events?.organizer_id;
    if (eventOrganizerId && eventOrganizerId !== user.id) {
      // Check gate_team first — organizer-invited scanners
      const { data: gateTeamEntry } = await supabase
        .from('gate_team')
        .select('id')
        .eq('organizer_id', eventOrganizerId)
        .eq('staff_email', user.email)
        .in('status', ['invited', 'active'])
        .maybeSingle();

      if (!gateTeamEntry) {
        // Fallback: check if user is a platform admin
        const { data: scannerProfile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        // S-2 FIX: Check all admin-level roles, not just 'admin'
        const ADMIN_ROLES = ['super_admin', 'admin', 'moderator'];
        if (!scannerProfile || !ADMIN_ROLES.includes(scannerProfile.role)) {
          return errorResponse(403, 'You are not authorized to scan tickets for this event', {}, req);
        }
      }
    }

    // ── Check if event has ended (24h grace period) ──
    const eventDate = ticketCheck?.ticket_tiers?.events?.date;
    if (eventDate) {
      const eventEnd = new Date(eventDate);
      eventEnd.setHours(eventEnd.getHours() + 24);
      if (new Date() > eventEnd) {
        return errorResponse(410, 'Event has ended. Ticket no longer valid for entry.', {}, req);
      }
    }

    // ── Execute scan via RPC (atomic, concurrency-safe) ──
    const { data: scanResult, error: scanError } = await supabase
      .rpc('scan_ticket', {
        p_ticket_id: ticket_id,
        p_scanned_by: user.id,
        p_device_info: deviceInfo,
        p_ip_address: ipAddress,
      });

    if (scanError) {
      console.error('scan_ticket RPC error:', scanError.message);
      return errorResponse(500, scanError.message || 'Scan failed', {}, req);
    }

    if (!scanResult) {
      return errorResponse(500, 'No response from scan engine', {}, req);
    }

    // ── Build response based on RPC result ──
    // Attach seat location from HMAC-verified QR payload
    if (qr_sec || qr_row || qr_seat) {
      scanResult.section = qr_sec || null;
      scanResult.row = qr_row || null;
      scanResult.seat = qr_seat || null;
    }

    // Map RPC result to HTTP status codes
    if (scanResult.valid) {
      return jsonResponse(scanResult);
    } else {
      // Determine appropriate HTTP status
      const httpStatus = scanResult.scan_result === 'rejected' ? 409 : 400;
      return errorResponse(httpStatus, scanResult.message || 'Scan rejected', scanResult, req);
    }

  } catch (err) {
    console.error('Verify error:', err);
    return errorResponse(500, err.message || 'Verification failed', {}, req);
  }
});
