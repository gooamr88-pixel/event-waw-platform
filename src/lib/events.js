/* ═══════════════════════════════════
   EVENT WAW — Events API
   ═══════════════════════════════════ */

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
export async function createCheckout({ tierId, quantity }) {
  const { data: { session } } = await supabase.auth.getSession();
  
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tier_id: tierId, quantity }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create checkout');
  }

  return response.json();
}

/**
 * Get events created by the current organizer.
 */
export async function getOrganizerEvents() {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      ticket_tiers (
        id, name, price, capacity, sold_count
      )
    `)
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
