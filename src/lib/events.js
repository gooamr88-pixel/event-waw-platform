/* ===================================
   EVENT WAW - Events API
   =================================== */

import { supabase } from './supabase.js';

/**
 * Fetch all published events with their ticket tiers.
 * Works for both authenticated and anonymous users.
 */
export async function getEvents({ limit = 20, offset = 0 } = {}) {
  // Show events from 24 hours ago onward (so today's events still appear)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      ticket_tiers (
        id, name, price, capacity, sold_count, sort_order
      )
    `)
    .eq('status', 'published')
    .gte('date', yesterday)
    .order('date', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('getEvents error:', error);
    throw error;
  }
  return data || [];
}

/**
 * Fetch a single event by ID with full details.
 */
export async function getEvent(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      ticket_tiers (
        id, name, description, price, capacity, sold_count, sort_order
      ),
      profiles!events_organizer_id_fkey (
        id, full_name, avatar_url
      )
    `)
    .eq('id', eventId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get real-time availability for a ticket tier.
 * True availability = capacity - active_reservations - valid_tickets
 */
export async function getTierAvailability(tierId) {
  const { data, error } = await supabase
    .rpc('get_tier_availability', { p_tier_id: tierId });

  if (error) throw error;
  return data;
}

/**
 * Create a reservation and get Stripe checkout URL.
 * This calls an Edge Function that:
 * 1. Creates an atomic reservation
 * 2. Creates a Stripe Checkout Session
 * 3. Returns the checkout URL
 */
export async function createCheckout({ tierId, quantity, promoCode }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const response = await fetch(
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/create-checkout',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tier_id: tierId, quantity, promo_code: promoCode || undefined }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create checkout');
  }

  return response.json();
}

/**
 * Create a guest checkout session (no auth required).
 * Sends guest info + tier selection to the Edge Function.
 * Returns { checkout_url, reservation_id }.
 */
export async function createGuestCheckout({ tierId, quantity, guestName, guestEmail, guestPhone, guestNationalId, promoCode }) {
  const response = await fetch(
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/create-checkout',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // No Authorization header - guest checkout
      },
      body: JSON.stringify({
        tier_id: tierId,
        quantity,
        is_guest: true,
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
        guest_national_id: guestNationalId,
        promo_code: promoCode || undefined,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create guest checkout');
  }

  return response.json();
}

/**
 * Get events created by the current organizer.
 * SECURITY: Explicitly filters by organizer_id (belt-and-suspenders with RLS).
 */
export async function getOrganizerEvents() {
  // Get current user for explicit filtering
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      ticket_tiers (
        id, name, price, capacity, sold_count
      )
    `)
    .eq('organizer_id', user.id)  // Explicit filter + RLS
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Create a new event.
 */
export async function createEvent(eventData) {
  const { data, error } = await supabase
    .from('events')
    .insert(eventData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update an existing event.
 */
export async function updateEvent(eventId, updates) {
  const { data, error } = await supabase
    .from('events')
    .update(updates)
    .eq('id', eventId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a seated checkout (auth user with specific seat selections).
 * Sends seat_ids[] to the Edge Function which calls reserve_seats().
 */
export async function createSeatedCheckout({ tierId, seatIds }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const response = await fetch(
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/create-checkout',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tier_id: tierId,
        quantity: seatIds.length,
        seat_ids: seatIds,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create seated checkout');
  }

  return response.json();
}

/**
 * Create a seated guest checkout (no auth, with specific seat selections).
 */
export async function createGuestSeatedCheckout({ tierId, seatIds, guestName, guestEmail, guestPhone, guestNationalId }) {
  const response = await fetch(
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/create-checkout',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tier_id: tierId,
        quantity: seatIds.length,
        seat_ids: seatIds,
        is_guest: true,
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
        guest_national_id: guestNationalId,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create guest seated checkout');
  }

  return response.json();
}

/**
 * Fetch venue map for an event (returns null if no map exists).
 */
export async function getVenueMap(eventId) {
  const { data, error } = await supabase
    .from('venue_maps')
    .select('id, layout_json, version')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    console.error('getVenueMap error:', error);
    return null;
  }
  return data;
}

/**
 * Archive an event (sets status to 'archived').
 * Use this for events that have sold tickets — preserves all financial data.
 *
 * @param {string} eventId - The event UUID to archive
 * @returns {{ success: boolean, error?: string }}
 */
export async function archiveEvent(eventId) {
  try {
    const { data, error } = await supabase
      .from('events')
      .update({ status: 'archived' })
      .eq('id', eventId)
      .select('id');

    if (error) {
      return { success: false, error: error.message };
    }
    if (!data || data.length === 0) {
      return { success: false, error: 'Archive was blocked — you may not have permission.' };
    }
    return { success: true };
  } catch (err) {
    console.error('archiveEvent error:', err);
    return { success: false, error: err.message || 'Unexpected error' };
  }
}

/**
 * Delete an event.
 * SAFETY: Refuses to delete if ANY tickets have been issued — use archiveEvent instead.
 * RELIES ON: ON DELETE CASCADE for child tables (ticket_tiers, venue_maps,
 *            seats, promo_codes, reservations) — set in the database schema.
 *
 * @param {string} eventId - The event UUID to delete
 * @returns {{ success: boolean, error?: string }}
 */
export async function deleteEvent(eventId) {
  try {
    // 1. Fetch tier IDs for the ticket-existence safety check
    const { data: tiers, error: tiersErr } = await supabase
      .from('ticket_tiers')
      .select('id')
      .eq('event_id', eventId);

    if (tiersErr) {
      return { success: false, error: 'Failed to look up ticket tiers: ' + tiersErr.message };
    }

    const tierIds = Array.isArray(tiers)
      ? tiers.map(t => t.id).filter(Boolean)
      : [];

    // 2. Block deletion if any tickets have been issued
    if (tierIds.length > 0) {
      const { count, error: countErr } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .in('ticket_tier_id', tierIds);

      if (countErr) {
        return { success: false, error: 'Failed to check tickets: ' + countErr.message };
      }

      if (count && count > 0) {
        return {
          success: false,
          error: `Cannot delete: ${count} ticket(s) have been issued for this event. Cancel all tickets first.`,
        };
      }
    }

    // 3. Clean up storage files (best-effort, not handled by DB cascades)
    try {
      const { data: files } = await supabase.storage.from('event-covers').list(`events/${eventId}`);
      if (files && files.length > 0) {
        const paths = files.map(f => `events/${eventId}/${f.name}`);
        await supabase.storage.from('event-covers').remove(paths);
      }
    } catch (_) { /* storage cleanup is best-effort */ }

    // 4. Set status to 'draft' so RLS delete policy accepts it
    //    (events_delete_draft allows DELETE only for status='draft')
    const { error: statusErr } = await supabase
      .from('events')
      .update({ status: 'draft' })
      .eq('id', eventId);

    if (statusErr) {
      return { success: false, error: 'Failed to prepare event for deletion: ' + statusErr.message };
    }

    // 5. Delete the event — ON DELETE CASCADE handles all child records
    const { data: deleted, error: deleteErr } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId)
      .select('id');

    if (deleteErr) {
      return { success: false, error: deleteErr.message };
    }

    // RLS can silently block the delete: 0 rows removed, no error
    if (!deleted || deleted.length === 0) {
      return {
        success: false,
        error: 'Deletion was blocked — you may not have permission to delete this event, or its status prevents deletion.',
      };
    }

    return { success: true };
  } catch (err) {
    console.error('deleteEvent unexpected error:', err);
    return { success: false, error: err.message || 'Unexpected error during deletion' };
  }
}
