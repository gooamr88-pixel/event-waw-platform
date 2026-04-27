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

  // Revenue button switches to analytics
  document.getElementById('payout-btn')?.addEventListener('click', () => switchToPanel('analytics'));
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
        <div style="display:flex;gap:4px">
          <button class="ev-btn-icon" title="Edit" data-action="edit" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
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
      return;
    }
    tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';
    try {
      const { data: tiers } = await supabase.from('ticket_tiers').select('id').eq('event_id', eventId);
      if (!tiers?.length) { tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No tiers found</td></tr>'; return; }
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, attendee_name, attendee_email, tier_name, status, scanned_at, created_at, seat_section, seat_row, seat_number')
        .in('ticket_tier_id', tiers.map(t => t.id))
        .order('created_at', { ascending: false });

      if (!tickets?.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No tickets sold yet</td></tr>';
        return;
      }
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
      document.getElementById('ticket-csv-btn')?.onclick = () => {
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

    try {
      const event = await createEvent(eventData);
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
  // Clean up any existing edit modals to prevent duplicates
  document.querySelectorAll('.ev-modal-overlay.ev-edit-modal').forEach(m => m.remove());

  const { data: ev, error } = await supabase.from('events').select('*').eq('id', eventId).single();
  if (error || !ev) { showToast('Failed to load event', 'error'); return; }

  const evDate = ev.date ? new Date(ev.date) : new Date();
  const dateStr = evDate.toISOString().slice(0, 10);
  const timeStr = evDate.toTimeString().slice(0, 5);

  const modal = document.createElement('div');
  modal.className = 'ev-modal-overlay active ev-edit-modal';
  modal.innerHTML = `<div class="ev-modal" style="max-width:480px">
    <div class="ev-modal-header"><h2>✏️ Edit Event</h2><button class="ev-modal-close" id="edit-close">✕</button></div>
    <div style="padding:12px 16px;background:var(--ev-border-lt);border-radius:10px;margin-bottom:18px;font-weight:600;font-size:.9rem">📅 ${escapeHTML(ev.title)}</div>
    <div class="ev-form-row">
      <div class="ev-form-group"><label>Date</label><input class="ev-form-input" type="date" id="edit-date" value="${dateStr}" /></div>
      <div class="ev-form-group"><label>Time</label><input class="ev-form-input" type="time" id="edit-time" value="${timeStr}" /></div>
    </div>
    <div class="ev-form-group"><label>Description</label><textarea class="ev-form-input" id="edit-desc" rows="3">${escapeHTML(ev.description || '')}</textarea></div>
    <div class="ev-form-row">
      <div class="ev-form-group"><label>Venue</label><input class="ev-form-input" type="text" id="edit-venue" value="${escapeHTML(ev.venue || ev.location || '')}" /></div>
      <div class="ev-form-group"><label>City</label><input class="ev-form-input" type="text" id="edit-city" value="${escapeHTML(ev.city || '')}" /></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="ev-btn ev-btn-outline" id="edit-cancel" style="flex:1">Cancel</button>
      <button class="ev-btn ev-btn-pink" id="edit-save" style="flex:1">Save Changes</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

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
        date: new Date(`${d}T${t || '00:00'}:00`).toISOString(),
        description: document.getElementById('edit-desc').value.trim(),
      };
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

  tbody.innerHTML = '<tr><td colspan="8" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';

  try {
    const user = await getCurrentUser();
    const { data, error } = await supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id });

    if (error) throw error;
    if (!data?.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="ev-table-empty">No financial data yet</td></tr>';
      return;
    }

    let filtered = data;
    if (eventId) filtered = data.filter(r => r.event_id === eventId);
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="ev-table-empty">No data for selected event</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(r.event_title || '—')}</td>
      <td>${r.total_tickets_sold || 0} tickets</td>
      <td style="font-size:.8rem">—</td>
      <td style="font-weight:600">$${Number(r.gross_revenue || 0).toLocaleString()}</td>
      <td style="font-size:.8rem">—</td>
      <td style="color:var(--ev-pink);font-weight:700">$${Number(r.net_revenue || 0).toLocaleString()}</td>
      <td><span class="ev-badge ${Number(r.net_revenue) > 0 ? 'published' : 'pending'}">${Number(r.net_revenue) > 0 ? 'Earned' : 'Pending'}</span></td>
    </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" class="ev-table-empty">No financial data yet</td></tr>';
  }
}

