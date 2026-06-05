import { supabase, SUPABASE_FUNCTIONS_URL } from './supabase.js';
import { safeQuery } from './api.js';
import { escapeHTML, formatCurrency } from './utils.js';
import { setSafeHTML, generateSkeletonRows } from './dom.js';
import { showToast } from './dashboard-ui.js';

// Module-level cache for the last-loaded ticket data (for search filtering)
let _cachedTickets = [];
let _cachedTierMap = {};
let _cachedOrderMap = {};
let _visibleCount = 50;
let _filteredTickets = [];
let _searchTimeout = null;

export function setupTicketsPanel(events) {
  const select = document.getElementById('ticket-event-select');
  const searchInput = document.getElementById('ticket-search-input');
  const tbody = document.getElementById('tickets-tbody');
  console.log('[Tickets] setupTicketsPanel called, select element:', !!select);

  // ── Search handler: client-side filter of loaded tickets ──
  searchInput?.addEventListener('input', () => {
    if (_searchTimeout) clearTimeout(_searchTimeout);
    _searchTimeout = setTimeout(() => {
      const query = (searchInput.value || '').trim().toLowerCase();
      _visibleCount = 50; // Reset pagination
      _filteredTickets = filterTickets(_cachedTickets, query);
      renderTicketRows(_filteredTickets.slice(0, _visibleCount));
      renderLoadMoreButton();
    }, 250); // 250ms debounce window
  });

  // Attach event delegation listener once
  tbody?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ev-btn-resend');
    if (!btn || btn.disabled) return;

    const ticketId = btn.dataset.ticketId;
    btn.disabled = true;
    btn.style.opacity = '0.4';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/generate-ticket-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ ticket_id: ticketId }),
      });

      if (!res.ok) throw new Error('Failed to generate PDF');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ticket-${ticketId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Ticket PDF downloaded', 'success');
    } catch (err) {
      showToast('Resend failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });

  const loadTicketsForEvent = async () => {
    const eventId = select.value;
    console.log('[Tickets] loadTicketsForEvent fired, eventId:', eventId);
    if (searchInput) searchInput.value = '';
    _cachedTickets = [];
    _filteredTickets = [];
    _visibleCount = 50;
    renderLoadMoreButton();

    if (!eventId) {
      setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">Select an event to view tickets</td></tr>');
      document.getElementById('tkt-stat-sold').textContent = '0';
      document.getElementById('tkt-stat-scanned').textContent = '0';
      document.getElementById('tkt-stat-revenue').textContent = '$0';
      return;
    }
    setSafeHTML(tbody, generateSkeletonRows(['20px', '120px', '180px', '80px', '60px', '90px', '70px', '50px'], 5));

    // ── Stale-response guard: if user selected a different event mid-flight, bail ──
    const loadEventId = eventId;
    const isStale = () => select.value !== loadEventId;
    
    try {
      const { data: tiers, error: tierErr } = await supabase.from('ticket_tiers').select('id, name, price, currency').eq('event_id', eventId);
      if (isStale()) return;
      console.log('[Tickets] Tiers response:', { tiers: tiers?.length, tierErr });
      if (tierErr) {
        console.error('Tier query error:', tierErr);
        setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">Error loading tiers</td></tr>');
        _filteredTickets = [];
        renderLoadMoreButton();
        return;
      }
      if (!tiers?.length) {
        setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No tiers found</td></tr>');
        _filteredTickets = [];
        renderLoadMoreButton();
        return;
      }
      _cachedTierMap = {};
      tiers.forEach(t => { _cachedTierMap[t.id] = t; });

      const { data: tickets, error: tickErr } = await safeQuery(
        supabase.from('tickets').select('*').in('ticket_tier_id', tiers.map(t => t.id)).order('created_at', { ascending: false })
      );
      if (isStale()) return;
      console.log('[Tickets] Tickets response:', { count: tickets?.length, tickErr });

      if (tickErr) {
        console.error('Ticket query error:', tickErr);
        setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">Error loading tickets</td></tr>');
        _filteredTickets = [];
        renderLoadMoreButton();
        return;
      }

      if (!tickets?.length) {
        setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No tickets sold yet</td></tr>');
        document.getElementById('tkt-stat-sold').textContent = '0';
        document.getElementById('tkt-stat-scanned').textContent = '0';
        document.getElementById('tkt-stat-revenue').textContent = '$0';
        _filteredTickets = [];
        renderLoadMoreButton();
        return;
      }

      const orderIds = [...new Set(tickets.map(t => t.order_id).filter(Boolean))];
      _cachedOrderMap = {};
      if (orderIds.length) {
        try {
          const { data: orders } = await supabase.from('orders').select('id, guest_name, guest_email, user_id').in('id', orderIds);
          if (isStale()) return;
          if (orders) orders.forEach(o => { _cachedOrderMap[o.id] = o; });
        } catch (e) { console.warn('Order lookup skipped:', e); }
      }

      const scannedCount = tickets.filter(t => t.scanned_at).length;
      const totalRev = tickets.reduce((s, t) => s + (_cachedTierMap[t.ticket_tier_id]?.price || 0), 0);
      document.getElementById('tkt-stat-sold').textContent = tickets.length;
      document.getElementById('tkt-stat-scanned').textContent = scannedCount;
      // P2-18 FIX: Use dynamic currency instead of hardcoded '$'
      const tierCurrency = tiers.find(t => t.currency)?.currency || 'USD';
      document.getElementById('tkt-stat-revenue').textContent = formatCurrency(totalRev, tierCurrency);
      
      _cachedTickets = tickets;
      _filteredTickets = tickets;
      _visibleCount = 50;
      renderTicketRows(_filteredTickets.slice(0, _visibleCount));
      renderLoadMoreButton();

      const csvBtn = document.getElementById('ticket-csv-btn');
      if (csvBtn) csvBtn.onclick = async () => {
        try {
          const { exportAttendeeReport } = await import('./csv-export.js');
          const eventName = document.getElementById('ticket-event-select')?.selectedOptions[0]?.textContent || 'Event';
          const count = await exportAttendeeReport(eventId, eventName, supabase);
          showToast(`Exported ${count} attendees to CSV`, 'success');
        } catch (err) {
          showToast('Export failed: ' + err.message, 'error');
        }
      };

      const pdfBtn = document.getElementById('ticket-pdf-btn');
      if (pdfBtn) pdfBtn.onclick = () => {
        const eventName = document.getElementById('ticket-event-select')?.selectedOptions[0]?.textContent || 'Event';
        const printWin = window.open('', '_blank', 'width=800,height=600');
        printWin.document.write(`<!DOCTYPE html><html><head><title>Tickets - ${escapeHTML(eventName)}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #222; }
            h1 { font-size: 1.3rem; margin-bottom: 4px; }
            p.sub { color: #666; font-size: .85rem; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: .85rem; }
            th { background: #f5f5f5; padding: 10px 8px; text-align: left; font-weight: 700; border-bottom: 2px solid #ddd; }
            td { padding: 8px; border-bottom: 1px solid #eee; }
            tr:nth-child(even) { background: #fafafa; }
            .badge { padding: 3px 8px; border-radius: 4px; font-size: .72rem; font-weight: 600; }
            .badge-scanned { background: #dcfce7; color: #16a34a; }
            .badge-pending { background: #fef3c7; color: #d97706; }
            @media print { body { padding: 0; } }
          </style></head><body>
          <h1> ${escapeHTML(eventName)} - Ticket Report</h1>
          <p class="sub">Generated: ${new Date().toLocaleString()}  Total: ${tickets.length} tickets</p>
          <table>
            <thead><tr><th>#</th><th>Attendee</th><th>Email</th><th>Tier</th><th>Seat</th><th>Status</th><th>Purchase Date</th></tr></thead>
            <tbody>${tickets.map((t, i) => {
              const order = _cachedOrderMap[t.order_id] || {};
              const name = t.attendee_name || order.guest_name || '-';
              const email = t.attendee_email || order.guest_email || '-';
              const tierName = _cachedTierMap[t.ticket_tier_id]?.name || '-';
              return `<tr>
              <td>${i + 1}</td>
              <td><strong>${escapeHTML(name)}</strong></td>
              <td>${escapeHTML(email)}</td>
              <td>${escapeHTML(tierName)}</td>
              <td>${escapeHTML(t.seat_label || '-')}</td>
              <td><span class="badge ${t.scanned_at ? 'badge-scanned' : 'badge-pending'}">${t.scanned_at ? '[OK] Scanned' : 'Pending'}</span></td>
              <td>${new Date(t.created_at).toLocaleDateString()}</td>
            </tr>`;
            }).join('')}</tbody>
          </table>
          <script>setTimeout(() => { window.print(); }, 300);<\/script>
        </body></html>`);
        printWin.document.close();
        showToast('PDF print dialog opened', 'success');
      };
    } catch (err) {
      console.error('[Tickets] Unexpected error:', err);
      setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty" style="color:var(--ev-danger)">${escapeHTML(err.message)}</td></tr>`);
      _filteredTickets = [];
      renderLoadMoreButton();
    }
  };

  select?.addEventListener('change', loadTicketsForEvent);

  // Auto-fire if populateEventSelects already pre-selected an event
  if (select && select.value) {
    console.log('[Tickets] Auto-firing for pre-selected event:', select.value);
    loadTicketsForEvent();
  }
}

/* ── Client-side search filter ── */
function filterTickets(tickets, query) {
  if (!query) return tickets;
  return tickets.filter(t => {
    const order = _cachedOrderMap[t.order_id] || {};
    const name = (t.attendee_name || order.guest_name || '').toLowerCase();
    const email = (t.attendee_email || order.guest_email || '').toLowerCase();
    const tierName = (_cachedTierMap[t.ticket_tier_id]?.name || '').toLowerCase();
    const seat = (t.seat_label || '').toLowerCase();
    const ticketId = (t.id || '').toLowerCase();
    const orderId = (t.order_id || '').toLowerCase();
    return name.includes(query) || email.includes(query) || tierName.includes(query) ||
           seat.includes(query) || ticketId.includes(query) || orderId.includes(query);
  });
}

function renderLoadMoreButton() {
  const container = document.getElementById('tickets-load-more-container');
  if (!container) return;
  
  if (_visibleCount >= _filteredTickets.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `<button class="ev-btn ev-btn-outline" id="tkt-load-more-btn" style="margin: 20px auto; display: block;">Load More</button>`;
  document.getElementById('tkt-load-more-btn')?.addEventListener('click', () => {
    _visibleCount += 50;
    renderTicketRows(_filteredTickets.slice(0, _visibleCount));
    renderLoadMoreButton();
  });
}

/* ── Render ticket rows with resend button ── */
function renderTicketRows(tickets) {
  const tbody = document.getElementById('tickets-tbody');
  if (!tbody) return;

  if (!tickets.length) {
    setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No results match your search</td></tr>');
    return;
  }

  const htmlString = tickets.map((t, i) => {
    const order = _cachedOrderMap[t.order_id] || {};
    const name = t.attendee_name || order.guest_name || (t.user_id ? t.user_id.substring(0, 8) : 'Guest');
    const email = t.attendee_email || order.guest_email || '-';
    const tierName = _cachedTierMap[t.ticket_tier_id]?.name || '-';
    return `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(name)}</td>
      <td>${escapeHTML(email)}</td>
      <td>${escapeHTML(tierName)}</td>
      <td>${escapeHTML(t.seat_label || '-')}</td>
      <td><span class="ev-badge ${t.scanned_at ? 'accepted' : 'pending'}">${t.scanned_at ? '[OK] Scanned' : 'Pending'}</span></td>
      <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(t.created_at).toLocaleDateString()}</td>
      <td>
        <button class="ev-btn-icon ev-btn-resend" data-ticket-id="${t.id}" title="Resend ticket PDF to attendee">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  setSafeHTML(tbody, htmlString);
}
