// ═══════════════════════════════════
// EVENT WAW — Verify Ticket Edge Function
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy verify-ticket --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';

const hmacSecret = Deno.env.get('HMAC_SECRET')!;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate the scanner user
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { qr_payload } = await req.json();
    if (!qr_payload) {
      return new Response(JSON.stringify({ error: 'qr_payload is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse QR payload
    let parsed;
    try {
      parsed = JSON.parse(qr_payload);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid QR code format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { ticket_id, order_id, tier_id, nonce, hash } = parsed;
    if (!ticket_id || !order_id || !hash) {
      return new Response(JSON.stringify({ error: 'Malformed ticket data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify HMAC signature
    const payload = JSON.stringify({ ticket_id, order_id, tier_id, nonce });
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
      return new Response(JSON.stringify({ error: 'Invalid ticket signature — possible forgery' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: 'Ticket not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify scanner is the event organizer
    const eventOrganizerId = ticket.ticket_tiers?.events?.organizer_id;
    if (eventOrganizerId && eventOrganizerId !== user.id) {
      // Allow for now in MVP — could restrict later
      console.warn(`Scanner ${user.id} is not organizer ${eventOrganizerId}`);
    }

    // Check ticket status
    if (ticket.status === 'scanned') {
      return new Response(JSON.stringify({
        error: `Ticket already scanned at ${new Date(ticket.scanned_at).toLocaleString()}`,
        ticket: {
          tier_name: ticket.ticket_tiers?.name,
          attendee: ticket.profiles?.full_name,
          scanned_at: ticket.scanned_at,
        },
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (ticket.status === 'cancelled') {
      return new Response(JSON.stringify({ error: 'Ticket has been cancelled' }), {
        status: 410,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: 'Failed to update ticket status' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
    return new Response(JSON.stringify({ error: err.message || 'Verification failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
