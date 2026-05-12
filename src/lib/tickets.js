/* ===================================
   EVENTSLI - Tickets API
   =================================== */

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
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/verify-ticket',
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
  // The webhook may not have arrived yet - poll for up to 20 seconds
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
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/verify-guest-ticket',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // No Authorization header - guest access
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

/**
 * Download a ticket PDF for a single ticket.
 * Calls the generate-ticket-pdf Edge Function.
 * @param {string} ticketId - UUID of the ticket
 * @returns {Promise<void>} Triggers browser download
 */
export async function downloadTicketPDF(ticketId) {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/generate-ticket-pdf',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token
          ? { 'Authorization': `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify({ ticket_id: ticketId }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || 'Failed to generate PDF');
  }

  // Trigger browser download
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eventsli-ticket-${ticketId.substring(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download a PDF containing ALL tickets in an order.
 * @param {string} orderId - UUID of the order
 * @returns {Promise<void>} Triggers browser download
 */
export async function downloadOrderPDF(orderId) {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/generate-ticket-pdf',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token
          ? { 'Authorization': `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify({ order_id: orderId }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || 'Failed to generate PDF');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eventsli-tickets-${orderId.substring(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download a guest's ticket PDF using order_id (no auth needed).
 * For guest users who received their order_id via email.
 * @param {string} orderId - UUID of the order
 * @returns {Promise<void>} Triggers browser download
 */
export async function downloadGuestPDF(orderId) {
  const response = await fetch(
    'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/generate-ticket-pdf',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || 'Failed to generate PDF');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eventsli-tickets-${orderId.substring(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Create a styled "Download PDF" button element.
 * Handles loading/error states automatically.
 *
 * @param {Object} options
 * @param {string} [options.ticketId] - Download single ticket PDF
 * @param {string} [options.orderId] - Download all tickets in order
 * @param {boolean} [options.isGuest=false] - Use guest download flow
 * @param {string} [options.label='Download PDF'] - Button label
 * @returns {HTMLButtonElement} The button element (append to your container)
 *
 * Usage:
 *   const btn = createDownloadButton({ orderId: order.id });
 *   document.getElementById('ticket-actions').appendChild(btn);
 */
export function createDownloadButton({ ticketId, orderId, isGuest = false, label = 'Download PDF' } = {}) {
  const btn = document.createElement('button');
  btn.className = 'ev-download-btn';
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    <span>${label}</span>
  `;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const span = btn.querySelector('span');
    const originalText = span.textContent;

    btn.disabled = true;
    span.textContent = 'Generating...';
    btn.classList.add('ev-download-btn--loading');

    try {
      if (isGuest && orderId) {
        await downloadGuestPDF(orderId);
      } else if (orderId) {
        await downloadOrderPDF(orderId);
      } else if (ticketId) {
        await downloadTicketPDF(ticketId);
      }
      span.textContent = 'Downloaded!';
      btn.classList.remove('ev-download-btn--loading');
      btn.classList.add('ev-download-btn--success');
      setTimeout(() => {
        span.textContent = originalText;
        btn.disabled = false;
        btn.classList.remove('ev-download-btn--success');
      }, 2000);
    } catch (err) {
      span.textContent = err.message || 'Failed';
      btn.classList.remove('ev-download-btn--loading');
      btn.classList.add('ev-download-btn--error');
      setTimeout(() => {
        span.textContent = originalText;
        btn.disabled = false;
        btn.classList.remove('ev-download-btn--error');
      }, 3000);
    }
  });

  // Inject styles once
  if (!document.getElementById('ev-download-btn-styles')) {
    const style = document.createElement('style');
    style.id = 'ev-download-btn-styles';
    style.textContent = `
      .ev-download-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        background: linear-gradient(135deg, rgba(167,139,250,0.15), rgba(167,139,250,0.05));
        border: 1px solid rgba(167,139,250,0.3);
        border-radius: 10px;
        color: #a78bfa;
        font-family: var(--ev-font, 'Inter', system-ui, sans-serif);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
      }
      .ev-download-btn:hover:not(:disabled) {
        background: linear-gradient(135deg, rgba(167,139,250,0.25), rgba(167,139,250,0.1));
        border-color: rgba(167,139,250,0.5);
        transform: translateY(-1px);
      }
      .ev-download-btn:disabled {
        opacity: 0.7;
        cursor: wait;
      }
      .ev-download-btn--loading svg {
        animation: ev-dl-spin 0.8s linear infinite;
      }
      .ev-download-btn--success {
        border-color: rgba(74,222,128,0.4) !important;
        color: #4ade80 !important;
      }
      .ev-download-btn--error {
        border-color: rgba(248,113,113,0.4) !important;
        color: #f87171 !important;
      }
      @keyframes ev-dl-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  return btn;
}
