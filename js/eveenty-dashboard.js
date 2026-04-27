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
  setupCoverUpload();
  setupEmailAttendees();

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
    populateEventSelects(events);
    initCharts(revenueData, events);
    if (revenueData?.length) renderRevenueBreakdown(revenueData);
    setupTicketsPanel(events);

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
    let statusLabel = isPast ? 'Past' : ev.status;

    return `<tr>
      <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
      <td><a href="event-detail.html?id=${ev.id}" class="ev-link" style="font-weight:600;font-size:.88rem">${escapeHTML(ev.title)}</a></td>
      <td><span style="font-weight:500">${sold}/${cap}</span> <span style="font-size:.75rem;color:var(--ev-text-muted)">sold</span></td>
      <td style="font-size:.8rem;color:var(--ev-text-sec)">${created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
      <td style="font-size:.8rem">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
      <td style="font-weight:600">${calcRevenue(ev)}</td>
      <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="ev-btn-icon" title="Edit" data-action="edit" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="ev-btn-icon" title="Venue Map" data-action="map" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
          </button>
          <button class="ev-btn-icon" title="Duplicate" data-action="duplicate" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="ev-btn-icon" title="Share Link" data-action="share" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
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
  if (editBtn) { showEditModal(editBtn.dataset.id); return; }

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
    const status = delBtn.dataset.status || 'published';
    if (sold > 0) { showToast(`Cannot delete: ${sold} ticket(s) sold`, 'error'); return; }
    if (status !== 'draft') {
      showToast('Only draft events can be deleted. Set status to "Draft" first.', 'error');
      return;
    }
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
      const { data: tiers } = await supabase.from('ticket_tiers').select('id, price').eq('event_id', eventId);
      if (!tiers?.length) { tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No tiers found</td></tr>'; return; }
      const tierPrices = {};
      tiers.forEach(t => { tierPrices[t.id] = t.price || 0; });
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, attendee_name, attendee_email, tier_name, ticket_tier_id, status, scanned_at, created_at, seat_section, seat_row, seat_number')
        .in('ticket_tier_id', tiers.map(t => t.id))
        .order('created_at', { ascending: false });

      if (!tickets?.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No tickets sold yet</td></tr>';
        document.getElementById('tkt-stat-sold').textContent = '0';
        document.getElementById('tkt-stat-scanned').textContent = '0';
        document.getElementById('tkt-stat-revenue').textContent = '$0';
        return;
      }

      // Update ticket stats
      const scannedCount = tickets.filter(t => t.scanned_at).length;
      const totalRev = tickets.reduce((s, t) => s + (tierPrices[t.ticket_tier_id] || 0), 0);
      document.getElementById('tkt-stat-sold').textContent = tickets.length;
      document.getElementById('tkt-stat-scanned').textContent = scannedCount;
      document.getElementById('tkt-stat-revenue').textContent = '$' + totalRev.toLocaleString();
      tbody.innerHTML = tickets.map((t, i) => `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${escapeHTML(t.attendee_name || '—')}</td>
        <td>${escapeHTML(t.attendee_email || '—')}</td>
        <td>${escapeHTML(t.tier_name || '—')}</td>
        <td>${t.seat_section ? `${t.seat_section} R${t.seat_row} S${t.seat_number}` : '—'}</td>
        <td><span class="ev-badge ${t.scanned_at ? 'accepted' : 'pending'}">${t.scanned_at ? '✓ Scanned' : 'Pending'}</span></td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(t.created_at).toLocaleDateString()}</td>
      </tr>`).join('');

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
   CREATE EVENT MODAL
   ══════════════════════════════════ */
function setupCreateModal() {
  const modal = document.getElementById('create-modal');
  const open = () => modal.classList.add('active');
  const close = () => modal.classList.remove('active');

  document.getElementById('header-create-event')?.addEventListener('click', (e) => { e.preventDefault(); open(); });
  document.getElementById('welcome-create-btn')?.addEventListener('click', open);
  document.getElementById('create-modal-close')?.addEventListener('click', close);
  modal?.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Add tier
  document.getElementById('add-tier-btn')?.addEventListener('click', () => {
    const container = document.getElementById('tiers-container');
    const row = document.createElement('div');
    row.className = 'ev-form-row';
    row.style.cssText = 'grid-template-columns:1fr 100px 80px;margin-bottom:8px;';
    row.innerHTML = `
      <input class="ev-form-input" type="text" placeholder="Tier name" data-tier="name" required />
      <input class="ev-form-input" type="number" placeholder="Price" data-tier="price" min="0" required />
      <input class="ev-form-input" type="number" placeholder="Qty" data-tier="capacity" min="1" required />`;
    container.appendChild(row);
  });

  // Submit
  document.getElementById('create-event-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const user = await getCurrentUser();
    if (!user) return;

    const eventData = {
      organizer_id: user.id,
      title: document.getElementById('ev-title').value.trim().slice(0, 200),
      description: document.getElementById('ev-desc').value.trim().slice(0, 5000),
      venue: document.getElementById('ev-venue').value.trim().slice(0, 300),
      city: document.getElementById('ev-city').value.trim().slice(0, 100),
      date: new Date(document.getElementById('ev-date').value).toISOString(),
      category: document.getElementById('ev-category').value.trim(),
      status: 'published',
    };

    if (!eventData.title || eventData.title.length < 3) {
      showToast('Event title must be at least 3 characters', 'error');
      btn.disabled = false; btn.innerHTML = '🚀 Create Event'; return;
    }
    if (!eventData.venue) {
      showToast('Venue is required', 'error');
      btn.disabled = false; btn.innerHTML = '🚀 Create Event'; return;
    }
    if (new Date(eventData.date) < new Date()) {
      showToast('Event date cannot be in the past', 'error');
      btn.disabled = false; btn.innerHTML = '🚀 Create Event'; return;
    }

    try {
      const event = await createEvent(eventData);

      // Upload cover image if selected
      if (pendingCoverFile) {
        const coverUrl = await uploadCoverImage(event.id);
        if (coverUrl) {
          await supabase.from('events').update({ cover_url: coverUrl }).eq('id', event.id);
        }
      }

      const tierRows = document.querySelectorAll('#tiers-container .ev-form-row, #tiers-container > div');
      for (const row of tierRows) {
        const name = row.querySelector('[data-tier="name"]')?.value;
        const price = parseFloat(row.querySelector('[data-tier="price"]')?.value) || 0;
        const capacity = parseInt(row.querySelector('[data-tier="capacity"]')?.value) || 100;
        if (name) await supabase.from('ticket_tiers').insert({ event_id: event.id, name, price, capacity });
      }
      close();
      e.target.reset();
      showToast('Event created successfully!', 'success');
      await loadDashboard();

      // Show venue map prompt
      const mapPrompt = document.createElement('div');
      mapPrompt.className = 'ev-modal-overlay active';
      mapPrompt.innerHTML = `<div class="ev-modal" style="max-width:420px;text-align:center;padding:32px">
        <div style="font-size:3rem;margin-bottom:12px">🎉</div>
        <h2 style="margin-bottom:8px">Event Created!</h2>
        <p style="color:var(--ev-text-sec);margin-bottom:24px;font-size:.88rem">Want to design a seating map for <strong>${escapeHTML(event.title)}</strong>?</p>
        <div style="display:flex;gap:10px">
          <button class="ev-btn ev-btn-outline" style="flex:1" id="map-skip">Skip for Now</button>
          <a href="venue-designer.html?event_id=${event.id}" class="ev-btn ev-btn-pink" style="flex:1;text-decoration:none;display:flex;align-items:center;justify-content:center">🗺️ Design Venue Map</a>
        </div>
      </div>`;
      document.body.appendChild(mapPrompt);
      document.getElementById('map-skip').addEventListener('click', () => mapPrompt.remove());
      mapPrompt.addEventListener('click', (ev) => { if (ev.target === mapPrompt) mapPrompt.remove(); });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🚀 Create Event';
    }
  });
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

async function loadApprovalData() {
  const tbody = document.getElementById('approval-tbody');
  const eventId = document.getElementById('approval-event-select')?.value;
  tbody.innerHTML = '<tr><td colspan="9" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';

  try {
    let query = supabase.from('vendor_requests').select('*').eq('status', approvalTabFilter).order('created_at', { ascending: false });
    if (eventId) query = query.eq('event_id', eventId);
    const { data, error } = await query;

    if (error) throw error;
    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(r.vendor_name || '—')}</td>
      <td>${escapeHTML(r.vendor_email || '—')}</td>
      <td>${escapeHTML(r.type || '—')}</td>
      <td>${escapeHTML(r.name || '—')}</td>
      <td>${escapeHTML(r.category || '—')}</td>
      <td>${r.price ? '$' + Number(r.price).toLocaleString() : '—'}</td>
      <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(r.created_at).toLocaleDateString()}</td>
      <td><span class="ev-badge ${approvalTabFilter}">${approvalTabFilter}</span></td>
    </tr>`).join('');
  } catch (err) {
    // Table may not exist yet — show empty state gracefully
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
      const promoData = {
        organizer_id: user.id,
        code: document.getElementById('promo-code').value.trim().toUpperCase(),
        discount_percent: parseInt(document.getElementById('promo-discount').value) || 0,
        max_uses: parseInt(document.getElementById('promo-max-uses').value) || null,
        event_id: document.getElementById('promo-event').value || null,
        expires_at: document.getElementById('promo-expires').value ? new Date(document.getElementById('promo-expires').value).toISOString() : null,
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
      const expired = p.expires_at && new Date(p.expires_at) < new Date();
      const statusClass = !p.is_active ? 'rejected' : expired ? 'past' : 'published';
      const statusLabel = !p.is_active ? 'Inactive' : expired ? 'Expired' : 'Active';
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:700;font-family:monospace;letter-spacing:1px">${escapeHTML(p.code)}</td>
        <td style="font-weight:600;color:var(--ev-pink)">${p.discount_percent}%</td>
        <td>${p.used_count || 0}${p.max_uses ? '/' + p.max_uses : ''}</td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${p.expires_at ? new Date(p.expires_at).toLocaleDateString() : '—'}</td>
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

    const { data: tickets } = await supabase
      .from('tickets')
      .select('id, attendee_name, tier_name, created_at, ticket_tier_id')
      .in('ticket_tier_id', tiers.map(t => t.id))
      .gt('created_at', lastSeen)
      .order('created_at', { ascending: false })
      .limit(20);

    if (tickets?.length) {
      dashNotifications = tickets.map(t => ({
        icon: '🎫',
        text: `<strong>${escapeHTML(t.attendee_name || 'Someone')}</strong> purchased a <strong>${escapeHTML(t.tier_name || '')}</strong> ticket for <strong>${escapeHTML(eventMap[tierEventMap[t.ticket_tier_id]] || '')}</strong>`,
        time: t.created_at,
        unread: true
      }));
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

function setupCoverUpload() {
  const fileInput = document.getElementById('ev-cover-file');
  const area = document.getElementById('cover-upload-area');
  if (!fileInput || !area) return;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error'); return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be under 5MB', 'error'); return;
    }

    pendingCoverFile = file;

    // Preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      let img = area.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        area.appendChild(img);
      }
      img.src = ev.target.result;
      area.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  });
}

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
        .select('attendee_email, attendee_name')
        .in('ticket_tier_id', tiers.map(t => t.id));

      const emails = [...new Set((tickets || []).filter(t => t.attendee_email).map(t => t.attendee_email))];
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
