// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Verify Ticket Edge Function (Hardened)
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy verify-ticket --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';

const hmacSecret = Deno.env.get('HMAC_SECRET')!;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function errorResponse(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate the scanner user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse(401, 'Missing Authorization header');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return errorResponse(401, 'Unauthorized');
    }

    const { qr_payload } = await req.json();
    if (!qr_payload) {
      return errorResponse(400, 'qr_payload is required');
    }

    // Parse QR payload
    let parsed;
    try {
      parsed = JSON.parse(qr_payload);
    } catch {
      return errorResponse(400, 'Invalid QR code format');
    }

    const { ticket_id, order_id, tier_id, nonce, hash, v, event_id: qr_event_id, user_id: qr_user_id, iat } = parsed;
    if (!ticket_id || !order_id || !hash) {
      return errorResponse(400, 'Malformed ticket data');
    }

    // Verify HMAC signature — support both v1 and v2 payload formats
    let payload: string;
    if (v === 2) {
      // v2 payload includes event_id, user_id, iat
      payload = JSON.stringify({ v: 2, ticket_id, order_id, event_id: qr_event_id, user_id: qr_user_id, tier_id, nonce, iat });
    } else {
      // v1 legacy payload
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
      return errorResponse(403, 'Invalid ticket signature — possible forgery');
    }

    // Look up ticket in database
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select(`
        id, status, scanned_at,
        ticket_tiers (
          name, price,
          events (
            id, title, organizer_id
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

    // Verify scanner is the event organizer
    const eventOrganizerId = ticket.ticket_tiers?.events?.organizer_id;
    if (eventOrganizerId && eventOrganizerId !== user.id) {
      // Log warning but allow for now (configurable in future)
      console.warn(`Scanner ${user.id} is not organizer ${eventOrganizerId}`);
    }

    // Check ticket status
    if (ticket.status === 'scanned') {
      return errorResponse(409, `Ticket already scanned at ${new Date(ticket.scanned_at).toLocaleString()}`, {
        ticket: {
          tier_name: ticket.ticket_tiers?.name,
          attendee: ticket.profiles?.full_name,
          scanned_at: ticket.scanned_at,
        },
      });
    }

    if (ticket.status === 'cancelled') {
      return errorResponse(410, 'Ticket has been cancelled');
    }

    // ── Mark as scanned ──
    const { error: updateError } = await supabase
      .from('tickets')
      .update({
        status: 'scanned',
        scanned_at: new Date().toISOString(),
        scanned_by: user.id,
      })
      .eq('id', ticket_id)
      .eq('status', 'valid'); // Optimistic lock — only update if still 'valid'

    if (updateError) {
      return errorResponse(500, 'Failed to update ticket status');
    }

    return new Response(JSON.stringify({
      valid: true,
      ticket: {
        id: ticket.id,
        tier_name: ticket.ticket_tiers?.name,
        event_title: ticket.ticket_tiers?.events?.title,
        attendee: ticket.profiles?.full_name,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Verify error:', err);
    return errorResponse(500, err.message || 'Verification failed');
  }
});
