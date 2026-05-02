/* ═══════════════════════════════════
   EVENT WAW DASHBOARD — Controller
   Single-file, modular, production-ready
   ═══════════════════════════════════ */

import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { getOrganizerEvents, createEvent, deleteEvent, updateEvent } from '../src/lib/events.js';
import { protectPage, performSignOut } from '../src/lib/guard.js';
import { escapeHTML } from '../src/lib/utils.js';

/* ══════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════ */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `ev-toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span> ${escapeHTML(message)}`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 300); }, 3500);
}

/* ══════════════════════════════════
   INIT
   ══════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await protectPage({ requireRole: 'organizer' });
  if (!auth) return;

  setupUserInfo(auth);
  setupSidebar();
  setupCreateModal();
  setupSearch();
  setupSignOut();
  setupApprovalPanel();
  setupPromoPanel();
  setupFinancialPanel();
  setupPayoutPanel();
  setupDarkMode();
  setupNotifications();
  setupCalendar();
  setupEmailAttendees();
  setupUserDropdown();
  setupProfilePanel();

  await loadDashboard();
});

/* ── User Info ── */
function setupUserInfo({ user, profile }) {
  const name = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const email = user?.email || '';
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-email').textContent = email;
  document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();
  const welcomeEl = document.getElementById('welcome-name');
  if (welcomeEl) welcomeEl.textContent = name.split(' ')[0];
}

/* ── Sign Out ── */
function setupSignOut() {
  document.getElementById('signout-btn')?.addEventListener('click', () => performSignOut('/index.html'));
}

/* ══════════════════════════════════
   SIDEBAR NAVIGATION
   ══════════════════════════════════ */
function switchToPanel(panelName) {
  const items = document.querySelectorAll('.ev-nav-item');
  const panels = document.querySelectorAll('.ev-panel');
  items.forEach(i => i.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`[data-panel="${panelName}"]`);
  if (navItem) navItem.classList.add('active');
  const panel = document.getElementById('panel-' + panelName);
  if (panel) panel.classList.add('active');
}

function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const overlay = document.getElementById('sidebar-overlay');

  document.querySelectorAll('.ev-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      switchToPanel(item.dataset.panel);
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  });

  toggle?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });

  // Header quick-nav buttons (Events / Tickets)
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchToPanel(btn.dataset.goto));
  });

  // Revenue button switches to financial
  document.getElementById('payout-btn')?.addEventListener('click', () => switchToPanel('financial'));
}

/* ══════════════════════════════════
   LOAD DASHBOARD DATA
   ══════════════════════════════════ */
async function loadDashboard() {
  try {
    const user = await getCurrentUser();
    const events = await getOrganizerEvents();

    // Stats
    const total = events.length;
    const live = events.filter(e => e.status === 'published').length;
    const draft = events.filter(e => e.status === 'draft').length;
    const past = events.filter(e => new Date(e.date) < new Date()).length;
    const review = events.filter(e => e.status === 'review' || e.status === 'in_review').length;

    animateCounter('stat-total', total);
    animateCounter('stat-live', live);
    animateCounter('stat-review', review);
    animateCounter('stat-past', past);
    animateCounter('stat-draft', draft);

    // Revenue
    let totalTickets = 0, totalRevenue = 0, totalScanned = 0, revenueData = null;
    try {
      const { data } = await supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id });
      revenueData = data;
      if (data) {
        data.forEach(r => {
          totalTickets += Number(r.total_tickets_sold);
          totalRevenue += Number(r.net_revenue);
          totalScanned += Number(r.scanned_count);
        });
      }
    } catch (e) { console.warn('Revenue RPC skipped:', e.message); }

    const scanRate = totalTickets > 0 ? Math.round((totalScanned / totalTickets) * 100) : 0;
    document.getElementById('ana-tickets').textContent = totalTickets.toLocaleString();
    document.getElementById('ana-revenue').textContent = '$' + totalRevenue.toLocaleString();
    document.getElementById('ana-scanrate').textContent = totalTickets > 0 ? scanRate + '%' : '—';

    renderEventsTable(events);
    setupTicketsPanel(events);
    populateEventSelects(events);
    initCharts(revenueData, events);
    if (revenueData?.length) renderRevenueBreakdown(revenueData);

    // Feed calendar
    calEvents = events;
    renderCalendar();

  } catch (err) {
    console.error('Dashboard error:', err);
    document.getElementById('events-tbody').innerHTML =
      `<tr><td colspan="8" class="ev-table-empty">${escapeHTML(err.message || 'Failed to load events. Please refresh.')}</td></tr>`;
  }
}

/* ── Animated Counter ── */
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  if (target === 0) { el.textContent = '0'; return; }
  let current = 0;
  const step = Math.max(1, Math.ceil(target / 20));
  const interval = setInterval(() => {
    current += step;
    if (current >= target) { current = target; clearInterval(interval); }
    el.textContent = current;
  }, 40);
}

/* ══════════════════════════════════
   EVENTS TABLE
   ══════════════════════════════════ */
let tableListenerAttached = false;

function renderEventsTable(events) {
  const tbody = document.getElementById('events-tbody');
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="ev-table-empty">No events yet — create your first one!</td></tr>';
    return;
  }

  tbody.innerHTML = events.map((ev, i) => {
    const date = new Date(ev.date);
    const created = new Date(ev.created_at);
    const isPast = date < new Date();
    const sold = ev.ticket_tiers?.reduce((s, t) => s + (t.sold_count || 0), 0) || 0;
    const cap = ev.ticket_tiers?.reduce((s, t) => s + t.capacity, 0) || 0;
    let statusClass = isPast ? 'past' : ev.status;
    let statusLabel = isPast ? 'Past' : (ev.status ? ev.status.charAt(0).toUpperCase() + ev.status.slice(1) : 'Draft');

    return `<tr>
      <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
      <td><a href="event-detail.html?id=${ev.id}" class="ev-link" style="font-weight:600;font-size:.88rem">${escapeHTML(ev.title)}</a></td>
      <td><span style="font-weight:500">${sold}/${cap}</span> <span style="font-size:.75rem;color:var(--ev-text-muted)">sold</span></td>
      <td style="font-size:.8rem;color:var(--ev-text-sec)">${created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
      <td style="font-size:.8rem">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
      <td style="font-weight:600">${calcRevenue(ev)}</td>
      <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="ev-btn-icon" title="Edit" data-action="edit" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="ev-btn-icon" title="Venue Map" data-action="map" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
          </button>
          <button class="ev-btn-icon" title="Delete" data-action="delete" data-id="${ev.id}" data-title="${escapeHTML(ev.title)}" data-sold="${sold}" data-status="${ev.status}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Attach once to avoid duplicate handlers
  if (!tableListenerAttached) {
    tableListenerAttached = true;
    tbody.addEventListener('click', handleTableAction);
  }
}

function calcRevenue(ev) {
  const r = ev.ticket_tiers?.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0) || 0;
  return r > 0 ? '$' + r.toLocaleString() : '—';
}

async function handleTableAction(e) {
  const editBtn = e.target.closest('[data-action="edit"]');
  if (editBtn) { await loadEventForEditing(editBtn.dataset.id); return; }

  const mapBtn = e.target.closest('[data-action="map"]');
  if (mapBtn) { window.location.href = `venue-designer.html?event_id=${mapBtn.dataset.id}`; return; }

  const dupBtn = e.target.closest('[data-action="duplicate"]');
  if (dupBtn) { await duplicateEvent(dupBtn.dataset.id); return; }

  const shareBtn = e.target.closest('[data-action="share"]');
  if (shareBtn) {
    const url = `${window.location.origin}/event-detail.html?id=${shareBtn.dataset.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Event link copied to clipboard!', 'success');
    } catch {
      prompt('Copy this link:', url);
    }
    return;
  }

  const delBtn = e.target.closest('[data-action="delete"]');
  if (delBtn) {
    const id = delBtn.dataset.id;
    const title = delBtn.dataset.title;
    const sold = Number(delBtn.dataset.sold || 0);
    if (sold > 0) { showToast(`Cannot delete "${title}": ${sold} ticket(s) already sold`, 'error'); return; }
    if (confirm(`Delete "${title}"? This cannot be undone.`)) {
      const result = await deleteEvent(id);
      if (result.success) { showToast('Event deleted', 'success'); await loadDashboard(); }
      else { showToast(result.error || 'Delete failed', 'error'); }
    }
  }
}

async function duplicateEvent(eventId) {
  try {
    const { data: ev, error } = await supabase.from('events').select('*').eq('id', eventId).single();
    if (error || !ev) { showToast('Failed to load event', 'error'); return; }
    const user = await getCurrentUser();
    const copy = {
      organizer_id: user.id,
      title: ev.title + ' (Copy)',
      description: ev.description,
      venue: ev.venue,
      city: ev.city,
      date: ev.date,
      category: ev.category,
      status: 'draft',
    };
    const newEvent = await createEvent(copy);
    // Copy tiers
    const { data: tiers } = await supabase.from('ticket_tiers').select('*').eq('event_id', eventId);
    if (tiers?.length) {
      for (const t of tiers) {
        await supabase.from('ticket_tiers').insert({
          event_id: newEvent.id, name: t.name, price: t.price, capacity: t.capacity
        });
      }
    }
    showToast(`Event duplicated as draft: "${copy.title}"`, 'success');
    await loadDashboard();
  } catch (err) {
    showToast('Duplicate failed: ' + err.message, 'error');
  }
}

/* ══════════════════════════════════
   POPULATE EVENT SELECTS
   ══════════════════════════════════ */
function populateEventSelects(events) {
  ['ticket-event-select', 'approval-event-select', 'fin-event-select', 'promo-event'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const first = el.querySelector('option');
    el.innerHTML = '';
    el.appendChild(first);
    events.forEach(ev => {
      const opt = document.createElement('option');
      opt.value = ev.id;
      opt.textContent = ev.title;
      el.appendChild(opt);
    });
    // Auto-select first event if available
    if (events.length > 0 && el.options.length > 1) {
      el.selectedIndex = 1;
      el.dispatchEvent(new Event('change'));
    }
  });
}

/* ══════════════════════════════════
   TICKETS PANEL
   ══════════════════════════════════ */
function setupTicketsPanel() {
  const select = document.getElementById('ticket-event-select');
  select?.addEventListener('change', async () => {
    const tbody = document.getElementById('tickets-tbody');
    const eventId = select.value;
    if (!eventId) {
      tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">Select an event to view tickets</td></tr>';
      document.getElementById('tkt-stat-sold').textContent = '0';
      document.getElementById('tkt-stat-scanned').textContent = '0';
      document.getElementById('tkt-stat-revenue').textContent = '$0';
      return;
    }
    tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';
    try {
      const { data: tiers, error: tierErr } = await supabase.from('ticket_tiers').select('id, name, price').eq('event_id', eventId);
      if (tierErr) { console.error('Tier query error:', tierErr); tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">Error loading tiers</td></tr>'; return; }
      if (!tiers?.length) { tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No tiers found</td></tr>'; return; }
      const tierMap = {};
      tiers.forEach(t => { tierMap[t.id] = t; });

      // Simple query — only core ticket columns
      const { data: tickets, error: tickErr } = await supabase
        .from('tickets')
        .select('*')
        .in('ticket_tier_id', tiers.map(t => t.id))
        .order('created_at', { ascending: false });

      if (tickErr) { console.error('Ticket query error:', tickErr); tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">Error loading tickets</td></tr>'; return; }

      if (!tickets?.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No tickets sold yet</td></tr>';
        document.getElementById('tkt-stat-sold').textContent = '0';
        document.getElementById('tkt-stat-scanned').textContent = '0';
        document.getElementById('tkt-stat-revenue').textContent = '$0';
        return;
      }

      // Fetch order info for guest names (separate query, won't break if columns missing)
      const orderIds = [...new Set(tickets.map(t => t.order_id).filter(Boolean))];
      let orderMap = {};
      if (orderIds.length) {
        try {
          const { data: orders } = await supabase.from('orders').select('id, guest_name, guest_email, user_id').in('id', orderIds);
          if (orders) orders.forEach(o => { orderMap[o.id] = o; });
        } catch (e) { console.warn('Order lookup skipped:', e); }
      }

      // Update ticket stats
      const scannedCount = tickets.filter(t => t.scanned_at).length;
      const totalRev = tickets.reduce((s, t) => s + (tierMap[t.ticket_tier_id]?.price || 0), 0);
      document.getElementById('tkt-stat-sold').textContent = tickets.length;
      document.getElementById('tkt-stat-scanned').textContent = scannedCount;
      document.getElementById('tkt-stat-revenue').textContent = '$' + totalRev.toLocaleString();
      tbody.innerHTML = tickets.map((t, i) => {
        const order = orderMap[t.order_id] || {};
        const name = t.attendee_name || order.guest_name || (t.user_id ? t.user_id.substring(0, 8) : 'Guest');
        const email = t.attendee_email || order.guest_email || '—';
        const tierName = tierMap[t.ticket_tier_id]?.name || '—';
        return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${escapeHTML(name)}</td>
        <td>${escapeHTML(email)}</td>
        <td>${escapeHTML(tierName)}</td>
        <td>—</td>
        <td><span class="ev-badge ${t.scanned_at ? 'accepted' : 'pending'}">${t.scanned_at ? '✓ Scanned' : 'Pending'}</span></td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(t.created_at).toLocaleDateString()}</td>
      </tr>`;
      }).join('');

      // CSV export
      const csvBtn = document.getElementById('ticket-csv-btn');
      if (csvBtn) csvBtn.onclick = () => {
        const rows = [['Name','Email','Tier','Seat','Status','Date']];
        tickets.forEach(t => rows.push([
          t.attendee_name||'', t.attendee_email||'', t.tier_name||'',
          t.seat_section ? `${t.seat_section} R${t.seat_row} S${t.seat_number}` : '',
          t.scanned_at ? 'Scanned' : 'Pending', t.created_at||''
        ]));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `tickets_${Date.now()}.csv`;
        a.click();
        showToast('CSV exported', 'success');
      };

      // PDF export
      const pdfBtn = document.getElementById('ticket-pdf-btn');
      if (pdfBtn) pdfBtn.onclick = () => {
        const eventName = document.getElementById('ticket-event-select')?.selectedOptions[0]?.textContent || 'Event';
        const printWin = window.open('', '_blank', 'width=800,height=600');
        printWin.document.write(`<!DOCTYPE html><html><head><title>Tickets — ${escapeHTML(eventName)}</title>
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
          <h1>🎫 ${escapeHTML(eventName)} — Ticket Report</h1>
          <p class="sub">Generated: ${new Date().toLocaleString()} • Total: ${tickets.length} tickets</p>
          <table>
            <thead><tr><th>#</th><th>Attendee</th><th>Email</th><th>Tier</th><th>Seat</th><th>Status</th><th>Purchase Date</th></tr></thead>
            <tbody>${tickets.map((t, i) => `<tr>
              <td>${i + 1}</td>
              <td><strong>${escapeHTML(t.attendee_name || '—')}</strong></td>
              <td>${escapeHTML(t.attendee_email || '—')}</td>
              <td>${escapeHTML(t.tier_name || '—')}</td>
              <td>${t.seat_section ? t.seat_section + ' R' + t.seat_row + ' S' + t.seat_number : '—'}</td>
              <td><span class="badge ${t.scanned_at ? 'badge-scanned' : 'badge-pending'}">${t.scanned_at ? '✓ Scanned' : 'Pending'}</span></td>
              <td>${new Date(t.created_at).toLocaleDateString()}</td>
            </tr>`).join('')}</tbody>
          </table>
          <script>setTimeout(() => { window.print(); }, 300);<\/script>
        </body></html>`);
        printWin.document.close();
        showToast('PDF print dialog opened', 'success');
      };
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="ev-table-empty" style="color:var(--ev-danger)">${escapeHTML(err.message)}</td></tr>`;
    }
  });
}

/* ══════════════════════════════════
   CHARTS
   ══════════════════════════════════ */
let revenueChartInstance = null, tierChartInstance = null;

function initCharts(revenueData, events) {
  if (typeof Chart === 'undefined') return;

  // Revenue line chart
  const rCtx = document.getElementById('revenue-chart');
  if (rCtx && revenueData?.length) {
    if (revenueChartInstance) revenueChartInstance.destroy();
    revenueChartInstance = new Chart(rCtx, {
      type: 'line',
      data: {
        labels: revenueData.map(d => {
          const dt = new Date(d.day || d.event_title);
          return isNaN(dt) ? (d.event_title || '—') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
        datasets: [{
          label: 'Revenue ($)',
          data: revenueData.map(d => Number(d.revenue || d.net_revenue || 0)),
          borderColor: '#F5C518', backgroundColor: 'rgba(245,197,24,.08)',
          fill: true, tension: 0.4, pointRadius: 4,
          pointBackgroundColor: '#F5C518', pointBorderWidth: 0,
          borderWidth: 2.5,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#999', font: { size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#999', font: { size: 10 } } },
        }
      }
    });
  }

  // Tier doughnut
  const tCtx = document.getElementById('tier-chart');
  if (tCtx && events?.length) {
    const tierMap = {};
    events.forEach(ev => {
      (ev.ticket_tiers || []).forEach(t => { tierMap[t.name] = (tierMap[t.name] || 0) + (t.sold_count || 0); });
    });
    const labels = Object.keys(tierMap);
    const values = Object.values(tierMap);
    if (labels.length) {
      if (tierChartInstance) tierChartInstance.destroy();
      tierChartInstance = new Chart(tCtx, {
        type: 'doughnut',
        data: {
          labels, datasets: [{
            data: values,
            backgroundColor: ['#F5C518','#E91E63','#2196F3','#4CAF50','#FF9800','#9C27B0','#00BCD4','#FF5722'],
            borderWidth: 0, hoverOffset: 8,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '68%',
          plugins: { legend: { position: 'bottom', labels: { color: '#777', font: { size: 11 }, padding: 16 } } }
        }
      });
    }
  }
}

/* ══════════════════════════════════
   REVENUE BREAKDOWN
   ══════════════════════════════════ */
function renderRevenueBreakdown(data) {
  const el = document.getElementById('revenue-breakdown');
  el.innerHTML = `<div class="ev-table-wrap"><table class="ev-table">
    <thead><tr><th>Event</th><th style="text-align:right">Gross</th><th style="text-align:right">Fee (5%)</th><th style="text-align:right">Net Payout</th><th style="text-align:center">Scan %</th></tr></thead>
    <tbody>${data.map(r => `<tr>
      <td><div style="font-weight:600">${escapeHTML(r.event_title)}</div><div style="font-size:.76rem;color:var(--ev-text-sec)">${r.total_tickets_sold} tickets</div></td>
      <td style="text-align:right;font-weight:600">$${Number(r.gross_revenue).toLocaleString()}</td>
      <td style="text-align:right;color:var(--ev-text-sec)">-$${Number(r.platform_fee).toLocaleString()}</td>
      <td style="text-align:right;color:var(--ev-pink);font-weight:700">$${Number(r.net_revenue).toLocaleString()}</td>
      <td style="text-align:center">${Number(r.scan_rate)}%</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/* ══════════════════════════════════
   SEARCH
   ══════════════════════════════════ */
function setupSearch() {
  document.getElementById('ev-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#events-tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

/* ══════════════════════════════════
   CREATE EVENT PANEL (Full Page Wizard)
   ══════════════════════════════════ */
let ceTicketCategories = [];
let ceTicketsList = [];
let ceGalleryCount = 1;
let ceTicketTableListenerAttached = false;
let ceKeywords = [];
let ceEditingEventId = null;

/* ── Load Event for Editing ── */
async function loadEventForEditing(eventId) {
  try {
    const { data: ev, error } = await supabase
      .from('events')
      .select(`*, ticket_tiers(id, name, price, capacity, ticket_type, category, early_bird_price, early_bird_end, max_scans, currency)`)
      .eq('id', eventId)
      .single();
    if (error || !ev) { showToast('Failed to load event', 'error'); return; }

    // Reset form first
    resetCreateEventForm();
    ceEditingEventId = eventId;

    // Update UI to "Edit" mode
    const breadcrumb = document.querySelector('#panel-create-event .ev-breadcrumb strong');
    if (breadcrumb) breadcrumb.textContent = 'Edit Event';
    const publishBtn = document.getElementById('ce-publish-btn');
    if (publishBtn) publishBtn.innerHTML = '💾 Update Event';

    // ── Fill basic fields ──
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    const setSelect = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) {
        const opt = Array.from(el.options).find(o => o.value === val);
        if (opt) el.value = val;
      }
    };

    setVal('ce-name', ev.title);
    setVal('ce-place', ev.venue);
    setVal('ce-address', ev.city); // legacy: city was used as address
    setVal('ce-city', ev.city);
    setSelect('ce-country', ev.country);
    setVal('ce-longitude', ev.longitude);
    setVal('ce-latitude', ev.latitude);
    setSelect('ce-category', ev.category);
    setVal('ce-pixel', ev.pixel_code);
    setSelect('ce-currency', ev.currency);
    setSelect('ce-timezone', ev.timezone);
    setVal('ce-website', ev.website);

    // Rich text editor
    const editor = document.getElementById('ce-overview');
    if (editor && ev.description) editor.innerHTML = ev.description;

    // Dates — convert ISO to datetime-local format
    const toLocalDatetime = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setVal('ce-start-date', toLocalDatetime(ev.date));
    setVal('ce-end-date', toLocalDatetime(ev.end_date));
    setVal('ce-doors', toLocalDatetime(ev.doors_open));

    // Show End Time radio
    if (ev.show_end_time === false) {
      const noRadio = document.querySelector('input[name="ce-show-end"][value="no"]');
      if (noRadio) noRadio.checked = true;
    }

    // Keywords
    if (ev.keywords && Array.isArray(ev.keywords)) {
      ceKeywords = [...ev.keywords];
      const tagsWrap = document.getElementById('ce-keywords-tags');
      if (tagsWrap) {
        tagsWrap.innerHTML = ceKeywords.map((k, i) =>
          `<span class="ce-tag">${escapeHTML(k)} <button type="button" data-idx="${i}">✕</button></span>`
        ).join('');
      }
    }

    // Social links
    if (ev.social_links && Array.isArray(ev.social_links) && ev.social_links.length) {
      const container = document.getElementById('ce-social-links');
      if (container) {
        container.innerHTML = ev.social_links.map(link => `
          <div class="ce-social-row">
            <select class="ev-form-input ce-social-select">
              <option value="">Select Platform</option>
              <option value="facebook" ${link.platform==='facebook'?'selected':''}>Facebook</option>
              <option value="instagram" ${link.platform==='instagram'?'selected':''}>Instagram</option>
              <option value="twitter" ${link.platform==='twitter'?'selected':''}>X (Twitter)</option>
              <option value="tiktok" ${link.platform==='tiktok'?'selected':''}>TikTok</option>
              <option value="linkedin" ${link.platform==='linkedin'?'selected':''}>LinkedIn</option>
              <option value="youtube" ${link.platform==='youtube'?'selected':''}>YouTube</option>
            </select>
            <input class="ev-form-input" type="url" placeholder="https://..." value="${escapeHTML(link.url || '')}" />
            <button type="button" class="ce-social-del" title="Remove">🗑️</button>
          </div>
        `).join('');
      }
    }

    // Load existing ticket tiers
    if (ev.ticket_tiers && ev.ticket_tiers.length) {
      ceTicketsList = ev.ticket_tiers.map(t => ({
        id: t.id,
        name: t.name,
        qty: t.capacity,
        price: t.price,
        category: t.category || '',
        earlyPrice: t.early_bird_price || '',
        earlyEnd: t.early_bird_end || '',
        currency: t.currency || 'USD',
      }));
      renderCeTicketsTable();
    }

    // Skip chooser — go directly to form for editing
    const listingChooser = document.getElementById('ce-listing-chooser');
    const wizardContent = document.getElementById('ce-wizard-content');
    if (listingChooser) listingChooser.style.display = 'none';
    if (wizardContent) wizardContent.style.display = 'block';

    // Determine listing type from DB data
    const editListingType = ev.listing_type || (ev.ticket_tiers?.length ? 'display_and_sell' : 'display_only');
    window.__ceListingType = () => editListingType;

    // Configure form based on listing type
    const bannerIcon = document.getElementById('ce-banner-icon');
    const bannerLabel = document.getElementById('ce-banner-label');
    const bannerDesc = document.getElementById('ce-banner-desc');
    const ticketsTab = document.getElementById('ce-tab-tickets');
    const ticketsStep = document.getElementById('ce-step-tickets');
    const currencyGroup = document.getElementById('ce-currency-group');

    if (editListingType === 'display_only') {
      if (bannerIcon) bannerIcon.textContent = '📢';
      if (bannerLabel) bannerLabel.textContent = 'Display Only';
      if (bannerDesc) bannerDesc.textContent = 'Event showcase — no ticket sales';
      if (ticketsTab) ticketsTab.style.display = 'none';
      if (ticketsStep) ticketsStep.style.display = 'none';
      if (currencyGroup) currencyGroup.style.display = 'none';
    } else {
      if (bannerIcon) bannerIcon.textContent = '🎫';
      if (bannerLabel) bannerLabel.textContent = 'Display & Sell Tickets';
      if (bannerDesc) bannerDesc.textContent = 'Full ticketing with Stripe payments & QR entry';
      if (ticketsTab) ticketsTab.style.display = '';
      if (ticketsStep) ticketsStep.style.display = '';
      if (currencyGroup) currencyGroup.style.display = '';
    }

    // Switch to the panel
    switchToPanel('create-event');
    showToast('Event loaded for editing', 'info');
  } catch (err) {
    showToast('Error loading event: ' + err.message, 'error');
  }
}

function resetCreateEventForm() {
  // Reset listing type chooser — show chooser, hide wizard
  const listingChooser = document.getElementById('ce-listing-chooser');
  const wizardContent = document.getElementById('ce-wizard-content');
  if (listingChooser) listingChooser.style.display = '';
  if (wizardContent) wizardContent.style.display = 'none';
  document.querySelectorAll('input[name="ce-listing-type"]').forEach(r => r.checked = false);
  const continueBtn = document.getElementById('ce-listing-continue');
  if (continueBtn) continueBtn.disabled = true;
  // Reset tickets tab visibility
  const ticketsTab = document.getElementById('ce-tab-tickets');
  const ticketsStep = document.getElementById('ce-step-tickets');
  if (ticketsTab) ticketsTab.style.display = '';
  if (ticketsStep) ticketsStep.style.display = '';
  // Reset currency group visibility
  const currencyGroup = document.getElementById('ce-currency-group');
  if (currencyGroup) currencyGroup.style.display = '';

  // Reset text/select inputs
  ['ce-name','ce-place','ce-address','ce-city','ce-longitude','ce-latitude','ce-keywords','ce-pixel','ce-website','ce-doors','ce-start-date','ce-end-date','ce-ticket-name','ce-ticket-price','ce-early-price','ce-early-end','ce-max-scans-day'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['ce-category','ce-currency','ce-timezone','ce-country'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  document.getElementById('ce-ticket-qty') && (document.getElementById('ce-ticket-qty').value = '1');
  document.getElementById('ce-max-scans') && (document.getElementById('ce-max-scans').value = '1');
  // Reset rich text editor
  const editor = document.getElementById('ce-overview');
  if (editor) editor.innerHTML = '';
  // Reset image uploads
  ['ce-main-photo-area','ce-logo-area'].forEach(id => {
    const area = document.getElementById(id);
    if (area) { area.classList.remove('has-image'); area.querySelector('img')?.remove(); }
  });
  // Reset gallery & sponsors
  const galleryGrid = document.getElementById('ce-gallery-grid');
  if (galleryGrid) galleryGrid.innerHTML = `<div class="ce-gallery-item"><label>Photo 1</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div></div>`;
  const sponsorsGrid = document.getElementById('ce-sponsors-grid');
  if (sponsorsGrid) sponsorsGrid.innerHTML = '';
  // Reset social links to 1 empty row
  const socialLinks = document.getElementById('ce-social-links');
  if (socialLinks) socialLinks.innerHTML = `<div class="ce-social-row"><select class="ev-form-input ce-social-select"><option value="">Select Platform</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select><input class="ev-form-input" type="url" placeholder="https://..." /><button type="button" class="ce-social-del" title="Remove">🗑️</button></div>`;
  // Reset keywords tags
  const tagsWrap = document.getElementById('ce-keywords-tags');
  if (tagsWrap) tagsWrap.innerHTML = '';
  // Reset ticket categories & ticket list
  ceTicketCategories = [];
  ceTicketsList = [];
  ceGalleryCount = 1;
  ceKeywords = [];
  ceTicketTableListenerAttached = false;
  ceEditingEventId = null;
  // Reset UI to "Create" mode
  const breadcrumb = document.querySelector('#panel-create-event .ev-breadcrumb strong');
  if (breadcrumb) breadcrumb.textContent = 'Create Event';
  const publishBtn = document.getElementById('ce-publish-btn');
  if (publishBtn) publishBtn.innerHTML = '🚀 Publish Event';
  const catSelect = document.getElementById('ce-ticket-category-select');
  if (catSelect) catSelect.innerHTML = '<option value="">Select Category</option>';
  const ticketTbody = document.getElementById('ce-tickets-tbody');
  if (ticketTbody) ticketTbody.innerHTML = '<tr><td colspan="6" class="ev-table-empty">No tickets added yet</td></tr>';
  // Reset ticket type to Normal
  document.querySelectorAll('.ce-ticket-card').forEach(c => c.classList.remove('selected'));
  const normalCard = document.querySelector('.ce-ticket-card:first-child');
  if (normalCard) { normalCard.classList.add('selected'); normalCard.querySelector('input').checked = true; }
  // Reset tabs to Basic
  document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active','completed'));
  document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');
  document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
  document.getElementById('ce-step-basic')?.classList.add('active');
  const progressBar = document.getElementById('ce-progress-bar');
  if (progressBar) progressBar.style.width = '33%';
  // Reset cover file
  pendingCoverFile = null;
}

function setupCreateModal() {
  // Open create event panel instead of modal
  const openPanel = () => { resetCreateEventForm(); switchToPanel('create-event'); };

  document.getElementById('header-create-event')?.addEventListener('click', (e) => { e.preventDefault(); openPanel(); });
  document.getElementById('welcome-create-btn')?.addEventListener('click', openPanel);

  // Back to home
  document.getElementById('ce-back-home')?.addEventListener('click', (e) => { e.preventDefault(); switchToPanel('events'); });

  // ── Listing Type Chooser ──
  let ceListingType = null; // 'display_only' or 'display_and_sell'

  const listingRadios = document.querySelectorAll('input[name="ce-listing-type"]');
  const listingContinueBtn = document.getElementById('ce-listing-continue');
  const listingChooser = document.getElementById('ce-listing-chooser');
  const tabsWrap = document.getElementById('ce-tabs-wrap');
  const ticketsTab = document.getElementById('ce-tab-tickets');
  const ticketsStep = document.getElementById('ce-step-tickets');

  listingRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      ceListingType = radio.value;
      if (listingContinueBtn) listingContinueBtn.disabled = false;
    });
  });

  listingContinueBtn?.addEventListener('click', () => {
    if (!ceListingType) return;
    // Hide chooser, show entire wizard content
    if (listingChooser) listingChooser.style.display = 'none';
    const wizardContent = document.getElementById('ce-wizard-content');
    if (wizardContent) wizardContent.style.display = 'block';

    // Update banner content
    const bannerIcon = document.getElementById('ce-banner-icon');
    const bannerLabel = document.getElementById('ce-banner-label');
    const bannerDesc = document.getElementById('ce-banner-desc');
    if (ceListingType === 'display_only') {
      if (bannerIcon) bannerIcon.textContent = '📢';
      if (bannerLabel) bannerLabel.textContent = 'Display Only';
      if (bannerDesc) bannerDesc.textContent = 'Event showcase — no ticket sales';
    } else {
      if (bannerIcon) bannerIcon.textContent = '🎫';
      if (bannerLabel) bannerLabel.textContent = 'Display & Sell Tickets';
      if (bannerDesc) bannerDesc.textContent = 'Full ticketing with Stripe payments & QR entry';
    }

    // Currency field — only relevant when selling tickets
    const currencyGroup = document.getElementById('ce-currency-group');

    if (ceListingType === 'display_only') {
      // Hide tickets tab, step, and currency
      if (ticketsTab) ticketsTab.style.display = 'none';
      if (ticketsStep) ticketsStep.style.display = 'none';
      if (currencyGroup) currencyGroup.style.display = 'none';
    } else {
      // Show tickets tab, step, and currency
      if (ticketsTab) ticketsTab.style.display = '';
      if (ticketsStep) ticketsStep.style.display = '';
      if (currencyGroup) currencyGroup.style.display = '';
    }

    // Reset tabs
    document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active','completed'));
    document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');

    // Ensure basic step is active
    document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
    document.getElementById('ce-step-basic')?.classList.add('active');

    // Update progress
    const progress = document.getElementById('ce-progress-bar');
    const totalSteps = ceListingType === 'display_only' ? 2 : 3;
    if (progress) progress.style.width = `${(1 / totalSteps) * 100}%`;
  });

  // "Change Type" button — go back to chooser
  document.getElementById('ce-listing-change')?.addEventListener('click', () => {
    if (listingChooser) listingChooser.style.display = '';
    const wizardContent = document.getElementById('ce-wizard-content');
    if (wizardContent) wizardContent.style.display = 'none';
  });

  // Make listing type accessible to publish handler
  window.__ceListingType = () => ceListingType;

  // ── Tab switching ──
  const tabs = document.querySelectorAll('[data-ce-tab]');
  const steps = { basic: 'ce-step-basic', tickets: 'ce-step-tickets', publishing: 'ce-step-publishing' };

  function getTabOrder() {
    return ceListingType === 'display_only' ? ['basic', 'publishing'] : ['basic', 'tickets', 'publishing'];
  }

  function switchCeTab(tabName) {
    const tabOrder = getTabOrder();
    // Skip tickets tab if display_only
    if (ceListingType === 'display_only' && tabName === 'tickets') return;

    tabs.forEach(t => t.classList.remove('active'));
    Object.values(steps).forEach(id => document.getElementById(id)?.classList.remove('active'));
    const tab = document.querySelector(`[data-ce-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
    document.getElementById(steps[tabName])?.classList.add('active');
    // Mark completed tabs
    const idx = tabOrder.indexOf(tabName);
    tabOrder.forEach((t, i) => {
      const el = document.querySelector(`[data-ce-tab="${t}"]`);
      if (i < idx) el?.classList.add('completed');
      else el?.classList.remove('completed');
    });
    // Update progress
    const progress = document.getElementById('ce-progress-bar');
    if (progress) progress.style.width = `${((idx + 1) / tabOrder.length) * 100}%`;
    // Update preview when switching to publishing
    if (tabName === 'publishing') updateCePreview();
  }

  tabs.forEach(tab => tab.addEventListener('click', () => switchCeTab(tab.dataset.ceTab)));

  // Save & Continue buttons
  document.getElementById('ce-save-basic')?.addEventListener('click', () => {
    const name = document.getElementById('ce-name')?.value.trim();
    if (!name || name.length < 3) { showToast('Event name must be at least 3 characters', 'error'); return; }
    // If display_only, skip to publishing; otherwise go to tickets
    switchCeTab(ceListingType === 'display_only' ? 'publishing' : 'tickets');
  });
  document.getElementById('ce-save-tickets')?.addEventListener('click', () => switchCeTab('publishing'));

  // ── Rich Text Editor ──
  document.querySelectorAll('.ce-editor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('Enter URL:');
        if (url) document.execCommand(cmd, false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });

  // ── Keywords ──
  const keywordsInput = document.getElementById('ce-keywords');
  const keywordsWrap = document.getElementById('ce-keywords-tags');
  keywordsInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = keywordsInput.value.trim();
      if (val && !ceKeywords.includes(val)) {
        ceKeywords.push(val);
        renderKeywords();
      }
      keywordsInput.value = '';
    }
  });
  function renderKeywords() {
    keywordsWrap.innerHTML = ceKeywords.map((k, i) =>
      `<span class="ce-tag">${escapeHTML(k)} <button type="button" data-idx="${i}">✕</button></span>`
    ).join('');
    keywordsWrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => { ceKeywords.splice(Number(btn.dataset.idx), 1); renderKeywords(); });
    });
  }

  // ── Social Links ──
  document.getElementById('ce-add-social')?.addEventListener('click', () => {
    const container = document.getElementById('ce-social-links');
    const row = document.createElement('div');
    row.className = 'ce-social-row';
    row.innerHTML = `<select class="ev-form-input ce-social-select"><option value="">Select Platform</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select><input class="ev-form-input" type="url" placeholder="https://..." /><button type="button" class="ce-social-del" title="Remove">🗑️</button>`;
    container.appendChild(row);
  });
  document.getElementById('ce-social-links')?.addEventListener('click', (e) => {
    const del = e.target.closest('.ce-social-del');
    if (del) del.closest('.ce-social-row')?.remove();
  });

  // ── Image Uploads ──
  setupCeUpload('ce-main-photo', 'ce-main-photo-area');
  setupCeUpload('ce-logo', 'ce-logo-area');

  // ── Gallery ──
  document.getElementById('ce-add-gallery')?.addEventListener('click', () => {
    ceGalleryCount++;
    const grid = document.getElementById('ce-gallery-grid');
    const item = document.createElement('div');
    item.className = 'ce-gallery-item';
    item.innerHTML = `<label>Photo ${ceGalleryCount}</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div>`;
    grid.appendChild(item);
    const fileInput = item.querySelector('input[type="file"]');
    const area = item.querySelector('.ce-upload-area');
    fileInput.addEventListener('change', (e) => handleCeFileUpload(e, area));
  });

  // ── Sponsors ──
  document.getElementById('ce-add-sponsor')?.addEventListener('click', () => {
    const grid = document.getElementById('ce-sponsors-grid');
    const count = grid.children.length + 1;
    const item = document.createElement('div');
    item.className = 'ce-gallery-item';
    item.innerHTML = `<label>Sponsor ${count}</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Logo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div>`;
    grid.appendChild(item);
    const fileInput = item.querySelector('input[type="file"]');
    const area = item.querySelector('.ce-upload-area');
    fileInput.addEventListener('change', (e) => handleCeFileUpload(e, area));
  });

  // Initial gallery upload listener
  const initialGalleryInput = document.querySelector('#ce-gallery-grid input[type="file"]');
  const initialGalleryArea = document.querySelector('#ce-gallery-grid .ce-upload-area');
  if (initialGalleryInput && initialGalleryArea) {
    initialGalleryInput.addEventListener('change', (e) => handleCeFileUpload(e, initialGalleryArea));
  }

  // ── Ticket Type Cards ──
  document.querySelectorAll('.ce-ticket-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.ce-ticket-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      card.querySelector('input').checked = true;
    });
  });

  // ── Ticket Category Modal ──
  const ticketCatModal = document.getElementById('ticket-cat-modal');
  document.getElementById('ce-add-ticket-cat-btn')?.addEventListener('click', () => {
    document.getElementById('ticket-cat-count').textContent = `Current ticket category number: ${ceTicketCategories.length}`;
    ticketCatModal?.classList.add('active');
  });
  document.getElementById('ticket-cat-modal-close')?.addEventListener('click', () => ticketCatModal?.classList.remove('active'));
  ticketCatModal?.addEventListener('click', (e) => { if (e.target === ticketCatModal) ticketCatModal.classList.remove('active'); });

  document.getElementById('ticket-cat-save')?.addEventListener('click', () => {
    const name = document.getElementById('ticket-cat-name')?.value.trim();
    if (!name) { showToast('Category name is required', 'error'); return; }
    ceTicketCategories.push({ name, desc: document.getElementById('ticket-cat-desc')?.value.trim() || '' });
    // Update select
    const select = document.getElementById('ce-ticket-category-select');
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
    document.getElementById('ticket-cat-name').value = '';
    document.getElementById('ticket-cat-desc').value = '';
    ticketCatModal?.classList.remove('active');
    showToast(`Category "${name}" added!`, 'success');
  });

  // ── Add Ticket ──
  document.getElementById('ce-add-ticket-btn')?.addEventListener('click', () => {
    const name = document.getElementById('ce-ticket-name')?.value.trim();
    const qty = parseInt(document.getElementById('ce-ticket-qty')?.value) || 1;
    const price = parseFloat(document.getElementById('ce-ticket-price')?.value) || 0;
    const category = document.getElementById('ce-ticket-category-select')?.value;
    const earlyPrice = document.getElementById('ce-early-price')?.value || '';
    const earlyEnd = document.getElementById('ce-early-end')?.value || '';
    if (!name) { showToast('Ticket name is required', 'error'); return; }
    if (!price && price !== 0) { showToast('Ticket price is required', 'error'); return; }
    const currency = document.getElementById('ce-currency')?.value || 'USD';
    ceTicketsList.push({ name, qty, price, category, earlyPrice, earlyEnd, currency });
    renderCeTicketsTable();
    // Reset
    document.getElementById('ce-ticket-name').value = '';
    document.getElementById('ce-ticket-qty').value = '1';
    document.getElementById('ce-ticket-price').value = '';
    showToast('Ticket added!', 'success');
  });

  // ── Services Modal ──
  const svcModal = document.getElementById('services-modal');
  document.getElementById('services-modal-close')?.addEventListener('click', () => svcModal?.classList.remove('active'));
  svcModal?.addEventListener('click', (e) => { if (e.target === svcModal) svcModal.classList.remove('active'); });
  document.getElementById('svc-submit')?.addEventListener('click', () => {
    showToast('Service request submitted!', 'success');
    svcModal?.classList.remove('active');
  });

  // ── Publish Event ──
  document.getElementById('ce-publish-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('ce-publish-btn');

    // ── VALIDATION ──
    // Clear previous errors
    document.querySelectorAll('.ce-field-error').forEach(el => el.remove());
    document.querySelectorAll('.ce-error-border').forEach(el => el.classList.remove('ce-error-border'));

    const errors = [];
    const markError = (fieldId, message) => {
      const field = document.getElementById(fieldId);
      if (!field) return;
      field.classList.add('ce-error-border');
      const errEl = document.createElement('div');
      errEl.className = 'ce-field-error';
      errEl.textContent = message;
      field.parentElement.appendChild(errEl);
      // Auto-clear error when user interacts
      const clearFn = () => {
        field.classList.remove('ce-error-border');
        errEl.remove();
        field.removeEventListener('input', clearFn);
        field.removeEventListener('change', clearFn);
      };
      field.addEventListener('input', clearFn);
      field.addEventListener('change', clearFn);
      errors.push({ fieldId, message });
    };

    // Tab 1: Basic Information
    const name = document.getElementById('ce-name')?.value.trim();
    if (!name || name.length < 3) markError('ce-name', 'Event name is required (min 3 characters)');

    const place = document.getElementById('ce-place')?.value.trim();
    if (!place) markError('ce-place', 'Venue / Place name is required');

    const city = document.getElementById('ce-city')?.value.trim();
    if (!city) markError('ce-city', 'City is required');

    const country = document.getElementById('ce-country')?.value;
    if (!country) markError('ce-country', 'Country is required');

    const category = document.getElementById('ce-category')?.value;
    if (!category) markError('ce-category', 'Category is required');

    const currency = document.getElementById('ce-currency')?.value;
    if (!currency) markError('ce-currency', 'Currency is required');

    const timezone = document.getElementById('ce-timezone')?.value;
    if (!timezone) markError('ce-timezone', 'Time zone is required');

    const startDate = document.getElementById('ce-start-date')?.value;
    if (!startDate) markError('ce-start-date', 'Start date is required');

    const endDate = document.getElementById('ce-end-date')?.value;
    if (!endDate) markError('ce-end-date', 'End date is required');

    // Tab 2: Tickets (skip validation for display_only)
    const listingType = typeof window.__ceListingType === 'function' ? window.__ceListingType() : 'display_and_sell';
    if (listingType !== 'display_only' && ceTicketsList.length === 0) {
      errors.push({ fieldId: 'ce-ticket-name', message: 'At least one ticket is required', tab: 'tickets' });
      showToast('⚠️ You must add at least one ticket before publishing', 'error');
    }

    // If there are errors, show them and stop
    if (errors.length > 0) {
      // Build error summary
      const errorNames = errors.map(e => e.message).join('\n• ');
      showToast(`⚠️ Please fix ${errors.length} error(s):\n• ${errorNames}`, 'error');

      // Switch to the tab that has the first error
      const firstError = errors[0];
      if (firstError.tab === 'tickets') {
        // Switch to tickets tab
        document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-ce-tab="tickets"]')?.classList.add('active');
        document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
        document.getElementById('ce-step-tickets')?.classList.add('active');
      } else {
        // Switch to basic tab
        document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');
        document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
        document.getElementById('ce-step-basic')?.classList.add('active');
      }

      // Scroll to first error field
      const firstField = document.getElementById(firstError.fieldId);
      if (firstField) firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });

      return; // STOP — don't create/update event
    }

    btn.disabled = true;
    btn.textContent = ceEditingEventId ? 'Updating…' : 'Publishing…';
    try {
      const user = await getCurrentUser();
      if (!user) return;

      // Collect social links
      const socialLinks = [];
      document.querySelectorAll('#ce-social-links .ce-social-row').forEach(row => {
        const platform = row.querySelector('select')?.value;
        const url = row.querySelector('input[type="url"]')?.value?.trim();
        if (platform && url) socialLinks.push({ platform, url });
      });

      // Collect show_end_time radio
      const showEndTime = document.querySelector('input[name="ce-show-end"]:checked')?.value !== 'no';

      // Get listing type
      const listingType = typeof window.__ceListingType === 'function' ? window.__ceListingType() : 'display_and_sell';

      // Core event data (columns that always exist)
      const coreData = {
        organizer_id: user.id,
        title: name,
        description: document.getElementById('ce-overview')?.innerHTML || '',
        venue: place,
        city: city,
        date: new Date(startDate).toISOString(),
        category: category || 'general',
        status: 'published',
      };

      // Extra event data (new columns — may not exist yet)
      const extraData = {
        listing_type: listingType,
        longitude: parseFloat(document.getElementById('ce-longitude')?.value) || null,
        latitude: parseFloat(document.getElementById('ce-latitude')?.value) || null,
        country: country || null,
        keywords: ceKeywords.length ? ceKeywords : null,
        pixel_code: document.getElementById('ce-pixel')?.value.trim() || null,
        currency: currency || 'USD',
        timezone: timezone || null,
        doors_open: document.getElementById('ce-doors')?.value ? new Date(document.getElementById('ce-doors').value).toISOString() : null,
        end_date: endDate ? new Date(endDate).toISOString() : null,
        show_end_time: showEndTime,
        website: document.getElementById('ce-website')?.value.trim() || null,
        social_links: socialLinks.length ? socialLinks : null,
      };

      let event;
      if (ceEditingEventId) {
        // ── UPDATE existing event ──
        const allUpdates = { ...coreData, ...extraData };
        delete allUpdates.organizer_id;
        event = await updateEvent(ceEditingEventId, allUpdates);
      } else {
        // ── CREATE new event (core first, then extras) ──
        event = await createEvent(coreData);
        // Try adding extra fields
        try {
          await supabase.from('events').update(extraData).eq('id', event.id);
        } catch (extraErr) {
          console.warn('Extra event fields skipped:', extraErr.message);
        }
      }

      // Upload cover image
      if (pendingCoverFile) {
        const coverUrl = await uploadCoverImage(event.id);
        if (coverUrl) await supabase.from('events').update({ cover_url: coverUrl }).eq('id', event.id);
      }

      // Upload logo image
      const logoArea = document.getElementById('ce-logo-area');
      const logoInput = document.getElementById('ce-logo');
      if (logoInput?.files?.[0]) {
        const logoUrl = await uploadEventFile(event.id, logoInput.files[0], 'logo');
        if (logoUrl) await supabase.from('events').update({ logo_url: logoUrl }).eq('id', event.id);
      }

      // Upload gallery images
      const galleryInputs = document.querySelectorAll('#ce-gallery-grid input[type="file"]');
      const galleryUrls = [];
      for (let i = 0; i < galleryInputs.length; i++) {
        if (galleryInputs[i].files?.[0]) {
          const url = await uploadEventFile(event.id, galleryInputs[i].files[0], `gallery_${i}`);
          if (url) galleryUrls.push(url);
        }
      }
      if (galleryUrls.length) await supabase.from('events').update({ gallery_urls: galleryUrls }).eq('id', event.id);

      // Upload sponsor logos
      const sponsorInputs = document.querySelectorAll('#ce-sponsors-grid input[type="file"]');
      const sponsorUrls = [];
      for (let i = 0; i < sponsorInputs.length; i++) {
        if (sponsorInputs[i].files?.[0]) {
          const url = await uploadEventFile(event.id, sponsorInputs[i].files[0], `sponsor_${i}`);
          if (url) sponsorUrls.push(url);
        }
      }
      if (sponsorUrls.length) await supabase.from('events').update({ sponsor_urls: sponsorUrls }).eq('id', event.id);

      // Get selected ticket type
      const ticketType = document.querySelector('.ce-ticket-card.selected input')?.value || 'normal';

      // Only insert tickets if listing type is display_and_sell
      if (listingType !== 'display_only' && ceTicketsList.length > 0) {
        if (ceEditingEventId) {
          // ── UPDATE MODE: delete old tiers (with 0 sales) and re-insert ──
          const { data: existingTiers } = await supabase.from('ticket_tiers').select('id, sold_count').eq('event_id', event.id);
          for (const tier of (existingTiers || [])) {
            if ((tier.sold_count || 0) === 0) {
              await supabase.from('ticket_tiers').delete().eq('id', tier.id);
            }
          }
          // Insert updated tiers (skip ones that still exist with sales)
          const remainingIds = (existingTiers || []).filter(t => (t.sold_count || 0) > 0).map(t => t.id);
          for (const t of ceTicketsList) {
            if (t.id && remainingIds.includes(t.id)) {
              await supabase.from('ticket_tiers').update({
                name: t.name, price: t.price, capacity: t.qty,
                ticket_type: ticketType, category: t.category || null,
                early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
                early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
                max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
                currency: t.currency || 'USD',
              }).eq('id', t.id);
            } else {
              await supabase.from('ticket_tiers').insert({
                event_id: event.id, name: t.name, price: t.price, capacity: t.qty,
                ticket_type: ticketType, category: t.category || null,
                early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
                early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
                max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
                currency: t.currency || 'USD',
              });
            }
          }
        } else {
          // ── CREATE MODE: insert all tiers ──
          for (const t of ceTicketsList) {
            const { data: newTier, error: tierErr } = await supabase.from('ticket_tiers').insert({
              event_id: event.id, name: t.name, price: t.price, capacity: t.qty,
            }).select('id').single();

            if (tierErr) {
              console.warn('Tier insert failed:', tierErr.message);
              continue;
            }

            try {
              await supabase.from('ticket_tiers').update({
                ticket_type: ticketType, category: t.category || null,
                early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
                early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
                max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
                currency: t.currency || 'USD',
              }).eq('id', newTier.id);
            } catch (extraErr) {
              console.warn('Extra tier fields skipped:', extraErr.message);
            }
          }
        }
      }

      showToast(ceEditingEventId ? 'Event updated successfully!' : 'Event published successfully!', 'success');
      ceEditingEventId = null;
      switchToPanel('events');
      await loadDashboard();

      // Show services modal only on new events
      if (!ceEditingEventId) {
        setTimeout(() => { document.getElementById('services-modal')?.classList.add('active'); }, 600);
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = ceEditingEventId ? '💾 Update Event' : '🚀 Publish Event';
    }
  });

  // Stripe verification button
  document.getElementById('ce-complete-verify')?.addEventListener('click', () => {
    showToast('Stripe verification flow will be integrated', 'info');
  });
}

function setupCeUpload(inputId, areaId) {
  const input = document.getElementById(inputId);
  const area = document.getElementById(areaId);
  if (!input || !area) return;
  input.addEventListener('change', (e) => handleCeFileUpload(e, area));
}

function handleCeFileUpload(e, area) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); return; }
  // Store for main photo upload
  if (area.id === 'ce-main-photo-area') pendingCoverFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let img = area.querySelector('img');
    if (!img) { img = document.createElement('img'); area.appendChild(img); }
    img.src = ev.target.result;
    area.classList.add('has-image');
  };
  reader.readAsDataURL(file);
}

function renderCeTicketsTable() {
  const tbody = document.getElementById('ce-tickets-tbody');
  if (!ceTicketsList.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="ev-table-empty">No tickets added yet</td></tr>';
    return;
  }
  tbody.innerHTML = ceTicketsList.map((t, i) => {
    const sym = t.currency === 'CAD' ? 'CA$' : t.currency === 'EUR' ? '€' : t.currency === 'GBP' ? '£' : '$';
    return `<tr>
      <td style="font-weight:600">${escapeHTML(t.name)}</td>
      <td>${sym}${Number(t.price).toFixed(2)}</td>
      <td style="color:var(--ev-yellow);font-weight:600">${t.qty}</td>
      <td>${t.earlyEnd ? new Date(t.earlyEnd).toLocaleDateString() : 'Not Set'}</td>
      <td>${t.earlyPrice ? sym + Number(t.earlyPrice).toFixed(2) : '—'}</td>
      <td><button class="ev-btn-icon" title="Remove" data-del-ticket="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>
    </tr>`;
  }).join('');
  if (!ceTicketTableListenerAttached) {
    ceTicketTableListenerAttached = true;
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del-ticket]');
      if (btn) { ceTicketsList.splice(Number(btn.dataset.delTicket), 1); renderCeTicketsTable(); }
    });
  }
}

function updateCePreview() {
  const title = document.getElementById('ce-name')?.value.trim() || 'Event Name';
  document.getElementById('ce-preview-title').textContent = title;
  const venue = document.getElementById('ce-place')?.value.trim() || 'Venue';
  const addr = document.getElementById('ce-address')?.value.trim() || '';
  document.getElementById('ce-preview-venue').textContent = venue;
  document.getElementById('ce-preview-addr').textContent = addr;
  const startDate = document.getElementById('ce-start-date')?.value;
  const endDate = document.getElementById('ce-end-date')?.value;
  if (startDate) {
    const d = new Date(startDate);
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    document.getElementById('ce-preview-month').textContent = months[d.getMonth()];
    document.getElementById('ce-preview-day').textContent = String(d.getDate()).padStart(2, '0');
    document.getElementById('ce-preview-datestr').textContent = d.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    let timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (endDate) {
      const ed = new Date(endDate);
      timeStr += ` - ${ed.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}, ${ed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    }
    document.getElementById('ce-preview-timestr').textContent = timeStr;
  }
  // Preview image
  const mainImg = document.getElementById('ce-main-photo-area')?.querySelector('img');
  const previewImgDiv = document.getElementById('ce-preview-img');
  if (mainImg) {
    let pImg = previewImgDiv.querySelector('img');
    if (!pImg) { pImg = document.createElement('img'); previewImgDiv.innerHTML = ''; previewImgDiv.appendChild(pImg); }
    pImg.src = mainImg.src;
  }
}

/* ══════════════════════════════════
   EDIT EVENT MODAL
   ══════════════════════════════════ */
async function showEditModal(eventId) {
  document.querySelectorAll('.ev-modal-overlay.ev-edit-modal').forEach(m => m.remove());

  const { data: ev, error } = await supabase.from('events').select('*').eq('id', eventId).single();
  if (error || !ev) { showToast('Failed to load event', 'error'); return; }

  const evDate = ev.date ? new Date(ev.date) : new Date();
  const dateStr = evDate.toISOString().slice(0, 10);
  const timeStr = evDate.toTimeString().slice(0, 5);
  const isDraft = ev.status === 'draft';

  const modal = document.createElement('div');
  modal.className = 'ev-modal-overlay active ev-edit-modal';
  modal.innerHTML = `<div class="ev-modal" style="max-width:520px">
    <div class="ev-modal-header"><h2>✏️ Edit Event</h2><button class="ev-modal-close" id="edit-close">✕</button></div>
    <div class="ev-form-group">
      <label>Event Title</label>
      <input class="ev-form-input" type="text" id="edit-title" value="${escapeHTML(ev.title)}" />
    </div>
    <div class="ev-form-row">
      <div class="ev-form-group"><label>Date</label><input class="ev-form-input" type="date" id="edit-date" value="${dateStr}" /></div>
      <div class="ev-form-group"><label>Time</label><input class="ev-form-input" type="time" id="edit-time" value="${timeStr}" /></div>
    </div>
    <div class="ev-form-group"><label>Description</label><textarea class="ev-form-input" id="edit-desc" rows="3">${escapeHTML(ev.description || '')}</textarea></div>
    <div class="ev-form-row">
      <div class="ev-form-group"><label>Venue</label><input class="ev-form-input" type="text" id="edit-venue" value="${escapeHTML(ev.venue || ev.location || '')}" /></div>
      <div class="ev-form-group"><label>City</label><input class="ev-form-input" type="text" id="edit-city" value="${escapeHTML(ev.city || '')}" /></div>
    </div>
    <div class="ev-form-group">
      <label>Status</label>
      <div style="display:flex;gap:10px">
        <button class="ev-btn ${isDraft ? 'ev-btn-outline' : 'ev-btn-pink'}" id="edit-status-pub" type="button" style="flex:1">🟢 Published</button>
        <button class="ev-btn ${isDraft ? 'ev-btn-pink' : 'ev-btn-outline'}" id="edit-status-draft" type="button" style="flex:1">📝 Draft</button>
      </div>
      <input type="hidden" id="edit-status" value="${ev.status}" />
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="ev-btn ev-btn-outline" id="edit-cancel" style="flex:1">Cancel</button>
      <button class="ev-btn ev-btn-pink" id="edit-save" style="flex:1">Save Changes</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // Status toggle
  document.getElementById('edit-status-pub').addEventListener('click', () => {
    document.getElementById('edit-status').value = 'published';
    document.getElementById('edit-status-pub').className = 'ev-btn ev-btn-pink';
    document.getElementById('edit-status-draft').className = 'ev-btn ev-btn-outline';
  });
  document.getElementById('edit-status-draft').addEventListener('click', () => {
    document.getElementById('edit-status').value = 'draft';
    document.getElementById('edit-status-draft').className = 'ev-btn ev-btn-pink';
    document.getElementById('edit-status-pub').className = 'ev-btn ev-btn-outline';
  });

  const closeModal = () => modal.remove();
  document.getElementById('edit-close').addEventListener('click', closeModal);
  document.getElementById('edit-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('edit-save').addEventListener('click', async () => {
    const btn = document.getElementById('edit-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    const d = document.getElementById('edit-date').value;
    const t = document.getElementById('edit-time').value;
    if (!d) { showToast('Please select a date', 'error'); btn.disabled = false; btn.textContent = 'Save Changes'; return; }
    try {
      const updates = {
        title: document.getElementById('edit-title').value.trim().slice(0, 200),
        date: new Date(`${d}T${t || '00:00'}:00`).toISOString(),
        description: document.getElementById('edit-desc').value.trim(),
        status: document.getElementById('edit-status').value,
      };
      if (!updates.title || updates.title.length < 3) {
        showToast('Title must be at least 3 characters', 'error');
        btn.disabled = false; btn.textContent = 'Save Changes'; return;
      }
      const venue = document.getElementById('edit-venue').value.trim();
      const city = document.getElementById('edit-city').value.trim();
      if (venue) updates.venue = venue;
      if (city) updates.city = city;
      await updateEvent(eventId, updates);
      showToast('Event updated!', 'success');
      closeModal();
      await loadDashboard();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  });
}

/* ══════════════════════════════════
   APPROVAL PANEL
   ══════════════════════════════════ */
let approvalTabFilter = 'pending';

function setupApprovalPanel() {
  // Tab switching
  document.querySelectorAll('[data-approval-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-approval-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      approvalTabFilter = tab.dataset.approvalTab;
      loadApprovalData();
    });
  });

  // Event filter
  document.getElementById('approval-event-select')?.addEventListener('change', () => loadApprovalData());
}

let vendorTableExists = null; // null = unknown, true/false after first check

async function loadApprovalData() {
  const tbody = document.getElementById('approval-tbody');
  if (!tbody) return;
  const eventId = document.getElementById('approval-event-select')?.value;

  // If we already know the table doesn't exist, show empty immediately
  if (vendorTableExists === false) {
    tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
    return;
  }

  tbody.innerHTML = '<tr><td colspan="9" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';

  try {
    let query = supabase.from('vendor_requests').select('*').eq('status', approvalTabFilter).order('created_at', { ascending: false }).limit(20);
    if (eventId) query = query.eq('event_id', eventId);
    const { data, error } = await query;

    if (error) {
      vendorTableExists = false;
      tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
      return;
    }

    vendorTableExists = true;
    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(r.vendor_name || r.business_name || '—')}</td>
      <td>${escapeHTML(r.vendor_email || r.contact_email || '—')}</td>
      <td>${escapeHTML(r.type || r.category || '—')}</td>
      <td>${escapeHTML(r.name || r.business_name || '—')}</td>
      <td>${escapeHTML(r.category || '—')}</td>
      <td>${r.price ? '$' + Number(r.price).toLocaleString() : '—'}</td>
      <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(r.created_at).toLocaleDateString()}</td>
      <td><span class="ev-badge ${r.status || approvalTabFilter}">${r.status || approvalTabFilter}</span></td>
    </tr>`).join('');
  } catch (err) {
    vendorTableExists = false;
    tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
  }
}

/* ══════════════════════════════════
   PROMO CODE PANEL
   ══════════════════════════════════ */
function setupPromoPanel() {
  const modal = document.getElementById('promo-modal');
  const openModal = () => modal?.classList.add('active');
  const closeModal = () => modal?.classList.remove('active');

  document.getElementById('new-promo-btn')?.addEventListener('click', openModal);
  document.getElementById('promo-modal-close')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Search
  document.getElementById('promo-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#promo-tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  // Create promo
  document.getElementById('promo-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      const user = await getCurrentUser();
      const discountVal = parseInt(document.getElementById('promo-discount').value) || 0;
      const promoData = {
        organizer_id: user.id,
        code: document.getElementById('promo-code').value.trim().toUpperCase(),
        discount_type: 'percentage',
        discount_value: discountVal,
        max_uses: parseInt(document.getElementById('promo-max-uses').value) || 100,
        event_id: document.getElementById('promo-event').value || null,
        valid_until: document.getElementById('promo-expires').value ? new Date(document.getElementById('promo-expires').value).toISOString() : null,
        used_count: 0,
        is_active: true,
      };

      const { error } = await supabase.from('promo_codes').insert(promoData);
      if (error) throw error;

      closeModal();
      e.target.reset();
      showToast('Promo code created!', 'success');
      loadPromoCodes();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Create Promo Code';
    }
  });

  // Load on init
  loadPromoCodes();
}

async function loadPromoCodes() {
  const tbody = document.getElementById('promo-tbody');
  if (!tbody) return;

  try {
    const user = await getCurrentUser();
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('organizer_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="ev-table-empty">
        <div style="font-size:2.5rem;margin-bottom:12px">🏷️</div>
        <p style="font-weight:600;margin-bottom:4px">No promo codes yet</p>
        <p style="font-size:.84rem">Create your first promo code to offer discounts.</p>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((p, i) => {
      const expired = p.valid_until && new Date(p.valid_until) < new Date();
      const maxedOut = p.max_uses && p.used_count >= p.max_uses;
      const statusClass = !p.is_active ? 'rejected' : expired ? 'past' : maxedOut ? 'past' : 'published';
      const statusLabel = !p.is_active ? 'Inactive' : expired ? 'Expired' : maxedOut ? 'Maxed Out' : 'Active';
      const discountDisplay = p.discount_type === 'fixed' ? '$' + p.discount_value : (p.discount_value || p.discount_percent || 0) + '%';
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:700;font-family:monospace;letter-spacing:1px">${escapeHTML(p.code)}</td>
        <td style="font-weight:600;color:var(--ev-pink)">${discountDisplay}</td>
        <td>${p.used_count || 0}${p.max_uses ? '/' + p.max_uses : ''}</td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${p.valid_until ? new Date(p.valid_until).toLocaleDateString() : '—'}</td>
        <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
        <td><button class="ev-btn-icon" title="Delete" data-promo-delete="${p.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button></td>
      </tr>`;
    }).join('');

    // Delete handler (delegated)
    tbody.onclick = async (e) => {
      const delBtn = e.target.closest('[data-promo-delete]');
      if (!delBtn) return;
      if (!confirm('Delete this promo code?')) return;
      const { error } = await supabase.from('promo_codes').delete().eq('id', delBtn.dataset.promoDelete);
      if (error) showToast('Delete failed: ' + error.message, 'error');
      else { showToast('Promo deleted', 'success'); loadPromoCodes(); }
    };
  } catch (err) {
    // Table may not exist yet
    tbody.innerHTML = `<tr><td colspan="7" class="ev-table-empty">
      <div style="font-size:2.5rem;margin-bottom:12px">🏷️</div>
      <p style="font-weight:600;margin-bottom:4px">No promo codes yet</p>
      <p style="font-size:.84rem">Create your first promo code to offer discounts.</p>
    </td></tr>`;
  }
}

/* ══════════════════════════════════
   FINANCIAL PANEL
   ══════════════════════════════════ */
function setupFinancialPanel() {
  document.getElementById('fin-event-select')?.addEventListener('change', () => loadFinancialData());
  loadFinancialData();
}

async function loadFinancialData() {
  const tbody = document.getElementById('financial-tbody');
  if (!tbody) return;
  const eventId = document.getElementById('fin-event-select')?.value;

  tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';

  try {
    const user = await getCurrentUser();
    const { data, error } = await supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id });

    if (error) throw error;
    if (!data?.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No financial data yet</td></tr>';
      return;
    }

    let filtered = data;
    if (eventId) filtered = data.filter(r => r.event_id === eventId);
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No data for selected event</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((r, i) => {
      const gross = Number(r.gross_revenue || 0);
      const fee = Math.round(gross * 0.05 * 100) / 100;
      const net = gross - fee;
      return `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(r.event_title || '—')}</td>
      <td>${r.total_tickets_sold || 0} tickets</td>
      <td style="font-weight:600">$${gross.toLocaleString()}</td>
      <td style="color:var(--ev-danger);font-size:.8rem">-$${fee.toLocaleString()}</td>
      <td style="color:var(--ev-success);font-weight:700">$${net.toLocaleString()}</td>
      <td><span class="ev-badge ${net > 0 ? 'published' : 'pending'}">${net > 0 ? 'Earned' : 'Pending'}</span></td>
    </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No financial data yet</td></tr>';
  }
}

/* ══════════════════════════════════
   PAYOUT SETTINGS PANEL
   ══════════════════════════════════ */
function setupPayoutPanel() {
  // Load existing payout data
  loadPayoutData();

  document.getElementById('payout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const user = await getCurrentUser();
      const payoutData = {
        bank_name: document.getElementById('bank-name').value.trim(),
        account_holder: document.getElementById('account-holder').value.trim(),
        account_number: document.getElementById('account-number').value.trim(),
        swift_code: document.getElementById('swift-code').value.trim(),
        payout_currency: document.getElementById('payout-currency').value,
        payout_email: document.getElementById('payout-email').value.trim(),
      };

      if (!payoutData.bank_name || !payoutData.account_holder || !payoutData.account_number) {
        showToast('Please fill all required fields', 'error');
        return;
      }

      // Store in profile metadata
      const { error } = await supabase
        .from('profiles')
        .update({ payout_info: payoutData })
        .eq('id', user.id);

      if (error) throw error;
      showToast('Payout details saved securely!', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Save Payout Details';
    }
  });
}

async function loadPayoutData() {
  try {
    const user = await getCurrentUser();
    const { data } = await supabase
      .from('profiles')
      .select('payout_info')
      .eq('id', user.id)
      .single();

    if (data?.payout_info) {
      const p = data.payout_info;
      if (p.bank_name) document.getElementById('bank-name').value = p.bank_name;
      if (p.account_holder) document.getElementById('account-holder').value = p.account_holder;
      if (p.account_number) document.getElementById('account-number').value = p.account_number;
      if (p.swift_code) document.getElementById('swift-code').value = p.swift_code;
      if (p.payout_currency) document.getElementById('payout-currency').value = p.payout_currency;
      if (p.payout_email) document.getElementById('payout-email').value = p.payout_email;
    }
  } catch (_) { /* No payout info yet */ }
}

/* ══════════════════════════════════
   🌙 DARK MODE
   ══════════════════════════════════ */
function setupDarkMode() {
  const saved = localStorage.getItem('ev-dash-dark');
  if (saved === 'true') document.body.classList.add('dark-mode');

  document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('ev-dash-dark', document.body.classList.contains('dark-mode'));
  });
}

/* ══════════════════════════════════
   🔔 NOTIFICATIONS
   ══════════════════════════════════ */
let dashNotifications = [];

function setupNotifications() {
  const bell = document.getElementById('notif-bell');
  const dropdown = document.getElementById('notif-dropdown');

  // Toggle dropdown
  bell?.addEventListener('click', (e) => {
    if (e.target.closest('.ev-notif-dropdown')) return;
    dropdown.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!bell?.contains(e.target)) dropdown?.classList.remove('open');
  });

  // Mark all read
  document.getElementById('notif-clear')?.addEventListener('click', () => {
    dashNotifications = [];
    localStorage.setItem('ev-last-notif', new Date().toISOString());
    renderNotifications();
  });

  // Load recent ticket purchases as notifications
  loadNotifications();
}

async function loadNotifications() {
  try {
    const user = await getCurrentUser();
    const lastSeen = localStorage.getItem('ev-last-notif') || new Date(Date.now() - 86400000).toISOString();

    const { data: events } = await supabase.from('events').select('id, title').eq('organizer_id', user.id);
    if (!events?.length) return;

    const { data: tiers } = await supabase.from('ticket_tiers').select('id, event_id').in('event_id', events.map(e => e.id));
    if (!tiers?.length) return;

    const eventMap = {};
    events.forEach(e => { eventMap[e.id] = e.title; });
    const tierEventMap = {};
    tiers.forEach(t => { tierEventMap[t.id] = t.event_id; });

    // Also get tier names for display
    const { data: tiersWithNames } = await supabase.from('ticket_tiers').select('id, name, event_id').in('event_id', events.map(e => e.id));
    const tierNameMap = {};
    (tiersWithNames || []).forEach(t => { tierNameMap[t.id] = t.name; tierEventMap[t.id] = t.event_id; });

    const { data: tickets } = await supabase
      .from('tickets')
      .select('*')
      .in('ticket_tier_id', tiers.map(t => t.id))
      .gt('created_at', lastSeen)
      .order('created_at', { ascending: false })
      .limit(20);

    if (tickets?.length) {
      // Try to get attendee names from orders
      const orderIds = [...new Set(tickets.map(t => t.order_id).filter(Boolean))];
      let orderMap = {};
      if (orderIds.length) {
        try {
          const { data: orders } = await supabase.from('orders').select('id, guest_name').in('id', orderIds);
          if (orders) orders.forEach(o => { orderMap[o.id] = o; });
        } catch (_) {}
      }

      dashNotifications = tickets.map(t => {
        const guestName = orderMap[t.order_id]?.guest_name || t.attendee_name || 'Someone';
        const tierName = tierNameMap[t.ticket_tier_id] || '';
        return {
          icon: '🎫',
          text: `<strong>${escapeHTML(guestName)}</strong> purchased a <strong>${escapeHTML(tierName)}</strong> ticket for <strong>${escapeHTML(eventMap[tierEventMap[t.ticket_tier_id]] || '')}</strong>`,
          time: t.created_at,
          unread: true
        };
      });
    }
    renderNotifications();
  } catch (_) { /* Notifications are optional */ }
}

function renderNotifications() {
  const list = document.getElementById('notif-list');
  const bell = document.getElementById('notif-bell');
  if (!list) return;

  // Remove old badge
  bell?.querySelector('.ev-notif-badge')?.remove();

  if (!dashNotifications.length) {
    list.innerHTML = '<div class="ev-notif-empty">🎉 No new notifications</div>';
    bell?.classList.remove('has-notif');
    return;
  }

  // Add badge
  const badge = document.createElement('span');
  badge.className = 'ev-notif-badge';
  badge.textContent = dashNotifications.length;
  bell?.insertBefore(badge, bell.firstChild);
  bell?.classList.add('has-notif');

  list.innerHTML = dashNotifications.map(n => `
    <div class="ev-notif-item ${n.unread ? 'unread' : ''}">
      <div class="ev-notif-icon">${n.icon}</div>
      <div class="ev-notif-text">
        <p>${n.text}</p>
        <time>${timeAgo(n.time)}</time>
      </div>
    </div>
  `).join('');
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ══════════════════════════════════
   📅 CALENDAR VIEW
   ══════════════════════════════════ */
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let calEvents = [];

function setupCalendar() {
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    calMonth = new Date().getMonth();
    calYear = new Date().getFullYear();
    renderCalendar();
  });
}

function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month').textContent = `${monthNames[calMonth]} ${calYear}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  let html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    .map(d => `<div class="ev-calendar-day-header">${d}</div>`).join('');

  // Previous month fill
  const prevDays = new Date(calYear, calMonth, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="ev-calendar-cell other-month"><div class="ev-calendar-date">${prevDays - i}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calYear, calMonth, d);
    const isToday = date.toDateString() === today.toDateString();
    const dayEvents = calEvents.filter(ev => {
      const evDate = new Date(ev.date);
      return evDate.getDate() === d && evDate.getMonth() === calMonth && evDate.getFullYear() === calYear;
    });

    html += `<div class="ev-calendar-cell${isToday ? ' today' : ''}">`;
    html += `<div class="ev-calendar-date">${d}</div>`;
    dayEvents.forEach(ev => {
      const isPast = new Date(ev.date) < today;
      const cls = ev.status === 'draft' ? 'draft' : isPast ? 'past' : '';
      html += `<a href="event-detail.html?id=${ev.id}" class="ev-calendar-event ${cls}" title="${escapeHTML(ev.title)}">${escapeHTML(ev.title)}</a>`;
    });
    html += '</div>';
  }

  // Next month fill
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="ev-calendar-cell other-month"><div class="ev-calendar-date">${i}</div></div>`;
  }

  grid.innerHTML = html;
}

/* ══════════════════════════════════
   📸 COVER IMAGE UPLOAD
   ══════════════════════════════════ */
let pendingCoverFile = null;

async function uploadCoverImage(eventId) {
  if (!pendingCoverFile) return null;
  try {
    const ext = pendingCoverFile.name.split('.').pop();
    const path = `events/${eventId}/cover.${ext}`;
    const { error } = await supabase.storage.from('event-covers').upload(path, pendingCoverFile, { upsert: true });
    if (error) { console.warn('Cover upload failed:', error.message); return null; }
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    pendingCoverFile = null;
    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn('Cover upload error:', err);
    return null;
  }
}

async function uploadEventFile(eventId, file, label) {
  if (!file) return null;
  try {
    const ext = file.name.split('.').pop();
    const path = `events/${eventId}/${label}.${ext}`;
    const { error } = await supabase.storage.from('event-covers').upload(path, file, { upsert: true });
    if (error) { console.warn(`Upload ${label} failed:`, error.message); return null; }
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn(`Upload ${label} error:`, err);
    return null;
  }
}

/* ══════════════════════════════════
   📧 EMAIL ATTENDEES
   ══════════════════════════════════ */
function setupEmailAttendees() {
  document.getElementById('ticket-email-btn')?.addEventListener('click', async () => {
    const eventId = document.getElementById('ticket-event-select')?.value;
    if (!eventId) { showToast('Select an event first', 'error'); return; }

    const eventName = document.getElementById('ticket-event-select')?.selectedOptions[0]?.textContent || 'Event';

    // Fetch attendee emails
    try {
      const { data: tiers } = await supabase.from('ticket_tiers').select('id').eq('event_id', eventId);
      if (!tiers?.length) { showToast('No tiers found', 'error'); return; }
      const { data: tickets } = await supabase
        .from('tickets')
        .select('*')
        .in('ticket_tier_id', tiers.map(t => t.id));

      // Get emails from orders table (where guest emails are stored)
      const orderIds = [...new Set((tickets || []).map(t => t.order_id).filter(Boolean))];
      let allEmails = [];
      // First try attendee_email on tickets (if column exists)
      (tickets || []).forEach(t => { if (t.attendee_email) allEmails.push(t.attendee_email); });
      // Also try orders table
      if (orderIds.length) {
        try {
          const { data: orders } = await supabase.from('orders').select('id, guest_email').in('id', orderIds);
          if (orders) orders.forEach(o => { if (o.guest_email) allEmails.push(o.guest_email); });
        } catch (_) {}
      }
      const emails = [...new Set(allEmails)];
      if (!emails.length) { showToast('No attendee emails found', 'error'); return; }

      // Show compose modal
      const modal = document.createElement('div');
      modal.className = 'ev-modal-overlay active';
      modal.innerHTML = `<div class="ev-modal" style="max-width:560px">
        <div class="ev-modal-header">
          <h2>📧 Email Attendees</h2>
          <button class="ev-modal-close" id="email-close">✕</button>
        </div>
        <div class="ev-email-compose">
          <div class="ev-email-to">
            <span>To:</span>
            <strong>${escapeHTML(eventName)}</strong>
            <span class="ev-email-count">${emails.length} attendees</span>
          </div>
          <div class="ev-form-group">
            <label>Subject</label>
            <input class="ev-form-input" type="text" id="email-subject" value="Important Update: ${escapeHTML(eventName)}" />
          </div>
          <div class="ev-form-group">
            <label>Message</label>
            <textarea class="ev-form-input" id="email-body" rows="6" placeholder="Write your message to all attendees..."></textarea>
          </div>
          <div style="display:flex;gap:10px">
            <button class="ev-btn ev-btn-outline" id="email-cancel" style="flex:1">Cancel</button>
            <button class="ev-btn ev-btn-pink" id="email-send" style="flex:1">📨 Open in Email Client</button>
          </div>
        </div>
      </div>`;
      document.body.appendChild(modal);

      document.getElementById('email-close').onclick = () => modal.remove();
      document.getElementById('email-cancel').onclick = () => modal.remove();
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

      document.getElementById('email-send').addEventListener('click', () => {
        const subject = encodeURIComponent(document.getElementById('email-subject').value);
        const body = encodeURIComponent(document.getElementById('email-body').value);
        const bcc = emails.join(',');
        window.open(`mailto:?bcc=${bcc}&subject=${subject}&body=${body}`, '_self');
        showToast('Email client opened with attendee list!', 'success');
        modal.remove();
      });
    } catch (err) {
      showToast('Error loading attendees: ' + err.message, 'error');
    }
  });
}

/* ══════════════════════════════════
   👤 USER DROPDOWN
   ══════════════════════════════════ */
function setupUserDropdown() {
  // "Organizer Profile" button in dropdown
  document.getElementById('goto-profile')?.addEventListener('click', () => {
    switchToPanel('profile');
  });

  // "Sign Out" in dropdown
  document.getElementById('dropdown-signout')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to sign out?')) {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    }
  });

  // "Payout Settings" link inside profile panel
  document.getElementById('goto-payout-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchToPanel('payout');
  });
}

/* ══════════════════════════════════
   🏢 ORGANIZER PROFILE PANEL
   ══════════════════════════════════ */
function setupProfilePanel() {
  loadProfileData();

  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const user = await getCurrentUser();
      const profileData = {
        brand_name: document.getElementById('prof-brand').value.trim(),
        address: document.getElementById('prof-address').value.trim(),
        bio: document.getElementById('prof-bio').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        website: document.getElementById('prof-website').value.trim(),
        payment_method: document.getElementById('prof-payment').value,
        social: {
          instagram: document.getElementById('prof-ig').value.trim(),
          tiktok: document.getElementById('prof-tiktok').value.trim(),
          facebook: document.getElementById('prof-fb').value.trim(),
          x: document.getElementById('prof-x').value.trim(),
          linkedin: document.getElementById('prof-linkedin').value.trim(),
        }
      };

      if (!profileData.brand_name || !profileData.address || !profileData.bio) {
        showToast('Please fill all required fields', 'error');
        btn.disabled = false;
        btn.textContent = '💾 Save Profile';
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ organizer_profile: profileData })
        .eq('id', user.id);

      if (error) throw error;
      showToast('Profile saved successfully!', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Save Profile';
    }
  });
}

async function loadProfileData() {
  try {
    const user = await getCurrentUser();
    const { data } = await supabase
      .from('profiles')
      .select('organizer_profile')
      .eq('id', user.id)
      .single();

    if (data?.organizer_profile) {
      const p = data.organizer_profile;
      if (p.brand_name) document.getElementById('prof-brand').value = p.brand_name;
      if (p.address) document.getElementById('prof-address').value = p.address;
      if (p.bio) document.getElementById('prof-bio').value = p.bio;
      if (p.phone) document.getElementById('prof-phone').value = p.phone;
      if (p.website) document.getElementById('prof-website').value = p.website;
      if (p.payment_method) document.getElementById('prof-payment').value = p.payment_method;
      if (p.social) {
        if (p.social.instagram) document.getElementById('prof-ig').value = p.social.instagram;
        if (p.social.tiktok) document.getElementById('prof-tiktok').value = p.social.tiktok;
        if (p.social.facebook) document.getElementById('prof-fb').value = p.social.facebook;
        if (p.social.x) document.getElementById('prof-x').value = p.social.x;
        if (p.social.linkedin) document.getElementById('prof-linkedin').value = p.social.linkedin;
      }
    }
  } catch (_) { /* No profile data yet */ }
}
