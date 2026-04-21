/* ═══════════════════════════════════
   Dashboard Features — Tabs, Charts, Attendees, Scanner, Multi-step Form
   ═══════════════════════════════════ */

import { supabase } from '../src/lib/supabase.js';
import { escapeHTML } from '../src/lib/utils.js';

// ── Tab Navigation ──
export function initTabs() {
  document.querySelectorAll('.dash-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.dash-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('panel-' + tab.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });
}

// ── Multi-Step Form ──
let mapInstance = null, mapMarker = null;

export function initMultiStepForm() {
  const goTo = (step) => {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.step-progress-item').forEach(s => {
      const n = Number(s.dataset.step);
      s.classList.remove('active','completed');
      if (n < step) s.classList.add('completed');
      if (n === step) s.classList.add('active');
    });
    const target = document.querySelector(`[data-form-step="${step}"]`);
    if (target) target.classList.add('active');
    const fill = document.getElementById('step-line-fill');
    if (fill) fill.style.width = ((step - 1) / 2 * 100) + '%';
    if (step === 2 && !mapInstance) initMapPicker();
  };

  document.getElementById('step-next-1')?.addEventListener('click', () => {
    const title = document.getElementById('ev-title');
    const date = document.getElementById('ev-date');
    if (!title.value.trim()) { title.focus(); return; }
    if (!date.value) { date.focus(); return; }
    goTo(2);
  });
  document.getElementById('step-next-2')?.addEventListener('click', () => {
    const venue = document.getElementById('ev-venue');
    if (!venue.value.trim()) { venue.focus(); return; }
    goTo(3);
  });
  document.getElementById('step-back-2')?.addEventListener('click', () => goTo(1));
  document.getElementById('step-back-3')?.addEventListener('click', () => goTo(2));
}

function initMapPicker() {
  try {
    mapInstance = L.map('map-picker').setView([30.0444, 31.2357], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(mapInstance);
    setTimeout(() => mapInstance.invalidateSize(), 200);
    mapInstance.on('click', (e) => {
      const { lat, lng } = e.latlng;
      if (mapMarker) mapMarker.setLatLng([lat, lng]);
      else mapMarker = L.marker([lat, lng]).addTo(mapInstance);
      document.getElementById('ev-lat').value = lat.toFixed(6);
      document.getElementById('ev-lng').value = lng.toFixed(6);
      document.getElementById('map-coords-display').textContent = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    });
  } catch (e) { console.warn('Map init failed:', e); }
}

// ── Chart.js Analytics ──
let revenueChart = null, ticketsChart = null;

export function initCharts(revenueData, allEvents) {
  if (typeof Chart === 'undefined') return;
  initRevenueLineChart(revenueData);
  initTicketsDoughnut(allEvents);
}

function initRevenueLineChart(data) {
  const ctx = document.getElementById('revenue-line-chart');
  if (!ctx || !data?.length) return;
  const labels = data.map(d => {
    const dt = new Date(d.day || d.event_title);
    return isNaN(dt) ? (d.event_title || '—') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const values = data.map(d => Number(d.revenue || d.net_revenue || 0));
  const gold = 'rgba(212,175,55,1)';
  const goldFade = 'rgba(212,175,55,0.08)';
  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Revenue ($)', data: values,
        borderColor: gold, backgroundColor: goldFade,
        fill: true, tension: 0.4, pointRadius: 3,
        pointBackgroundColor: gold, pointBorderWidth: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#71717a', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#71717a', font: { size: 10 } } },
      }
    }
  });
}

function initTicketsDoughnut(events) {
  const ctx = document.getElementById('tickets-doughnut-chart');
  if (!ctx || !events?.length) return;
  const tierMap = {};
  events.forEach(ev => {
    (ev.ticket_tiers || []).forEach(t => {
      tierMap[t.name] = (tierMap[t.name] || 0) + (t.sold_count || 0);
    });
  });
  const labels = Object.keys(tierMap);
  const values = Object.values(tierMap);
  if (!labels.length) return;
  const colors = ['#D4AF37','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899'];
  if (ticketsChart) ticketsChart.destroy();
  ticketsChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels, datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 0, hoverOffset: 8,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#a1a1aa', font: { size: 11 }, padding: 16 } },
      }
    }
  });
}

// ── Attendee Management + CSV Export ──
let currentAttendees = [];

export function initAttendees(events) {
  const select = document.getElementById('attendee-event-select');
  const scannerSelect = document.getElementById('scanner-event-select');
  if (!select) return;
  select.innerHTML = '<option value="">Select an event…</option>';
  if (scannerSelect) scannerSelect.innerHTML = '<option value="">Select event to scan…</option>';
  events.forEach(ev => {
    select.innerHTML += `<option value="${ev.id}">${escapeHTML(ev.title)}</option>`;
    if (scannerSelect) scannerSelect.innerHTML += `<option value="${ev.id}">${escapeHTML(ev.title)}</option>`;
  });
  select.addEventListener('change', () => loadAttendees(select.value));
  document.getElementById('export-csv-btn')?.addEventListener('click', exportCSV);
  if (scannerSelect) {
    scannerSelect.addEventListener('change', () => {
      const btn = document.getElementById('start-scanner-btn');
      if (btn) btn.disabled = !scannerSelect.value;
    });
  }
  // Scanner redirect
  document.getElementById('start-scanner-btn')?.addEventListener('click', () => {
    const eid = scannerSelect?.value;
    if (eid) window.location.href = `scanner.html?event=${eid}`;
  });
}

async function loadAttendees(eventId) {
  const wrap = document.getElementById('attendees-table-wrap');
  const btn = document.getElementById('export-csv-btn');
  if (!eventId) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p class="empty-state-title">Select an Event</p><p class="empty-state-desc">Choose an event to view attendees.</p></div>';
    if (btn) btn.disabled = true;
    return;
  }
  wrap.innerHTML = '<div style="text-align:center;padding:32px;"><div class="spinner"></div></div>';
  try {
    const { data: tiers } = await supabase.from('ticket_tiers').select('id').eq('event_id', eventId);
    if (!tiers?.length) { wrap.innerHTML = '<p style="text-align:center;padding:32px;color:var(--text-muted);">No tiers found.</p>'; return; }
    const tierIds = tiers.map(t => t.id);
    const { data: tickets, error } = await supabase
      .from('tickets').select('id, attendee_name, attendee_email, tier_name, status, scanned_at, created_at, seat_section, seat_row, seat_number')
      .in('ticket_tier_id', tierIds).order('created_at', { ascending: false });
    if (error) throw error;
    currentAttendees = tickets || [];
    if (btn) btn.disabled = !currentAttendees.length;
    if (!currentAttendees.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎫</div><p class="empty-state-title">No Attendees Yet</p><p class="empty-state-desc">Tickets haven\'t been sold for this event.</p></div>';
      return;
    }
    wrap.innerHTML = `<div class="attendee-table-wrap"><table class="attendee-table"><thead><tr><th>Name</th><th>Email</th><th>Tier</th><th>Seat</th><th>Status</th><th>Date</th></tr></thead><tbody>${currentAttendees.map(t => `<tr>
      <td class="attendee-name">${escapeHTML(t.attendee_name || '—')}</td>
      <td>${escapeHTML(t.attendee_email || '—')}</td>
      <td>${escapeHTML(t.tier_name || '—')}</td>
      <td>${t.seat_section ? `${t.seat_section} R${t.seat_row} S${t.seat_number}` : '—'}</td>
      <td><span class="attendee-badge ${t.scanned_at ? 'scanned' : 'pending'}">${t.scanned_at ? '✓ Scanned' : 'Pending'}</span></td>
      <td style="font-size:0.8rem;color:var(--text-muted);">${new Date(t.created_at).toLocaleDateString()}</td>
    </tr>`).join('')}</tbody></table></div>`;
  } catch (err) {
    wrap.innerHTML = `<p style="text-align:center;padding:32px;color:#ef4444;">${err.message}</p>`;
  }
}

function exportCSV() {
  if (!currentAttendees.length) return;
  const headers = ['Name','Email','Tier','Seat','Status','Scanned At','Purchased'];
  const rows = currentAttendees.map(t => [
    t.attendee_name || '', t.attendee_email || '', t.tier_name || '',
    t.seat_section ? `${t.seat_section} R${t.seat_row} S${t.seat_number}` : '',
    t.scanned_at ? 'Scanned' : 'Pending', t.scanned_at || '', t.created_at || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendees_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Event Search Filter ──
export function initSearch() {
  document.getElementById('events-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#events-list .dash-event-row').forEach(row => {
      const title = row.querySelector('.dash-event-title')?.textContent?.toLowerCase() || '';
      row.style.display = title.includes(q) ? '' : 'none';
    });
  });
}
