// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Verify Ticket Edge Function (Hardened v3)
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
    if (!user) return errorResponse(401, authError || 'Unauthorized');

    // ── Rate Limit: 30 scans per minute per user ──
    if (!rateLimit(`verify:${user.id}`, 30, 60_000)) {
      return errorResponse(429, 'Too many scan attempts. Please slow down.');
    }

    // ── Parse request body ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { qr_payload } = body;
    if (!qr_payload || typeof qr_payload !== 'string') {
      return errorResponse(400, 'qr_payload is required and must be a string');
    }

    // Limit payload size to prevent abuse (max 2KB)
    if (qr_payload.length > 2048) {
      return errorResponse(400, 'QR payload too large');
    }

    // ── Parse QR payload ──
    let parsed;
    try {
      parsed = JSON.parse(qr_payload);
    } catch {
      return errorResponse(400, 'Invalid QR code format');
    }

    const { ticket_id, order_id, tier_id, nonce, hash, v, event_id: qr_event_id, user_id: qr_user_id, iat, is_guest: qr_is_guest, sec: qr_sec, row: qr_row, seat: qr_seat } = parsed;
    if (!ticket_id || !order_id || !hash) {
      return errorResponse(400, 'Malformed ticket data');
    }

    // ── Validate UUIDs ──
    if (!isValidUUID(ticket_id) || !isValidUUID(order_id)) {
      return errorResponse(400, 'Invalid ticket identifiers');
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
      return errorResponse(403, 'Invalid ticket signature — possible forgery');
    }

    // ── Look up ticket in database ──
    const supabase = createAdminClient();
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select(`
        id, status, scanned_at,
        ticket_tiers (
          name, price,
          events (
            id, title, organizer_id, date
          )
        ),
        profiles (
          full_name, email
        )
      `)
      .eq('id', ticket_id)
      .single();

    if (ticketError || !ticket) {
      return errorResponse(404, 'Ticket not found');
    }

    // ── Verify scanner is the event organizer (or admin) ──
    const eventOrganizerId = ticket.ticket_tiers?.events?.organizer_id;
    if (eventOrganizerId && eventOrganizerId !== user.id) {
      const { data: scannerProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (scannerProfile?.role !== 'admin') {
        return errorResponse(403, 'You are not authorized to scan tickets for this event');
      }
    }

    // ── Check if event has ended (24h grace period) ──
    const eventDate = ticket.ticket_tiers?.events?.date;
    if (eventDate) {
      const eventEnd = new Date(eventDate);
      eventEnd.setHours(eventEnd.getHours() + 24);
      if (new Date() > eventEnd) {
        return errorResponse(410, 'Event has ended. Ticket no longer valid for entry.');
      }
    }

    // ── Check ticket status ──
    if (ticket.status === 'scanned') {
      const dupTicket: any = {
        tier_name: ticket.ticket_tiers?.name,
        attendee: ticket.profiles?.full_name,
        scanned_at: ticket.scanned_at,
      };
      // Include seat location if present
      if (qr_sec || qr_row || qr_seat) {
        dupTicket.section = qr_sec || null;
        dupTicket.row = qr_row || null;
        dupTicket.seat = qr_seat || null;
      }
      return errorResponse(409, `Ticket already scanned at ${new Date(ticket.scanned_at).toLocaleString()}`, {
        ticket: dupTicket,
      });
    }

    if (ticket.status === 'cancelled') {
      return errorResponse(410, 'Ticket has been cancelled');
    }

    // ── Mark as scanned (optimistic lock — only update if still 'valid') ──
    const { data: updatedRows, error: updateError } = await supabase
      .from('tickets')
      .update({
        status: 'scanned',
        scanned_at: new Date().toISOString(),
        scanned_by: user.id,
      })
      .eq('id', ticket_id)
      .eq('status', 'valid')
      .select('id');

    if (updateError) {
      return errorResponse(500, 'Failed to update ticket status');
    }

    // If no rows updated, another scanner beat us (race condition)
    if (!updatedRows || updatedRows.length === 0) {
      return errorResponse(409, 'Ticket was just scanned by another device');
    }

    // ── Build response with seat location if present ──
    const responseTicket: any = {
      id: ticket.id,
      tier_name: ticket.ticket_tiers?.name,
      event_title: ticket.ticket_tiers?.events?.title,
      attendee: ticket.profiles?.full_name,
    };

    // Attach seat location from the QR payload (already HMAC-verified)
    if (qr_sec || qr_row || qr_seat) {
      responseTicket.section = qr_sec || null;
      responseTicket.row = qr_row || null;
      responseTicket.seat = qr_seat || null;
    }

    return jsonResponse({
      valid: true,
      ticket: responseTicket,
    });

  } catch (err) {
    console.error('Verify error:', err);
    return errorResponse(500, err.message || 'Verification failed');
  }
});
