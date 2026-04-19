/* ═══════════════════════════════════
   EVENT WAW — Tickets API
   ═══════════════════════════════════ */

import { supabase } from './supabase.js';

/**
 * Get all tickets for the current user, grouped by event.
 */
export async function getMyTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      *,
      orders (
        id, amount, status, created_at
      ),
      ticket_tiers (
        id, name, price,
        events (
          id, title, cover_image, venue, venue_address, date, status
        )
      )
    `)
    .in('status', ['valid', 'scanned'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Get a single ticket by ID.
 */
export async function getTicket(ticketId) {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      *,
      orders (id, amount, status, created_at),
      ticket_tiers (
        id, name, price,
        events (id, title, cover_image, venue, venue_address, date)
      )
    `)
    .eq('id', ticketId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Verify a ticket via the Edge Function (used by scanner).
 */
export async function verifyTicket(qrPayload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { valid: false, error: 'Session expired. Please sign in again.' };
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-ticket`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ qr_payload: qrPayload }),
    }
  );

  const result = await response.json();
  
  if (!response.ok) {
    return { valid: false, error: result.error || 'Verification failed', ticket: result.ticket || null };
  }

  return { valid: true, ticket: result.ticket };
}

/**
 * Get attendee list for an event (organizer only).
 */
export async function getEventAttendees(eventId) {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id, qr_hash, status, scanned_at, created_at,
      ticket_tiers!inner (
        id, name, price,
        events!inner ( id )
      ),
      profiles (
        full_name, email, phone
      )
    `)
    .eq('ticket_tiers.events.id', eventId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Get order + ticket data by Stripe session ID via RPC.
 * Works for BOTH guests and authenticated users (SECURITY DEFINER bypasses RLS).
 * Polls for up to 30 seconds waiting for the webhook to create the order.
 */
export async function getOrderBySessionPublic(sessionId) {
  const maxAttempts = 15;
  const delayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await supabase.rpc('get_order_by_session', {
      p_session_id: sessionId,
    });

    if (data) return data;

    if (attempt === maxAttempts) {
      console.warn('Order not found after polling (RPC). Webhook may be delayed.');
      return null;
    }

    console.log(`Waiting for order... attempt ${attempt}/${maxAttempts}`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return null;
}

/**
 * Get order details by Stripe session ID (used on success page).
 */
export async function getOrderBySession(sessionId) {
  // The webhook may not have arrived yet — poll for up to 20 seconds
  const maxAttempts = 10;
  const delayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        tickets (
          id, qr_hash, status,
          ticket_tiers (
            name, price,
            events (title, venue, date, cover_image)
          )
        )
      `)
      .eq('stripe_session_id', sessionId)
      .maybeSingle();

    if (data) return data;

    // If last attempt, give up
    if (attempt === maxAttempts) {
      console.warn('Order not found after polling. Webhook may have failed.');
      return null;
    }

    // Wait before retrying
    console.log(`Waiting for order... attempt ${attempt}/${maxAttempts}`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return null;
}

/**
 * Get tickets for a guest purchase via secure token.
 * The token was sent via email after guest checkout.
 * This calls an Edge Function that validates the token and returns ticket data.
 */
export async function getGuestTickets(guestToken) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-guest-ticket`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // No Authorization header — guest access
      },
      body: JSON.stringify({ guest_token: guestToken }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Invalid or expired access link');
  }

  return response.json();
}
