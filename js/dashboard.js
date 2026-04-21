/* ═══════════════════════════════════
   EVENT WAW — Organizer Dashboard (Main)
   All original logic preserved + new feature imports
   ═══════════════════════════════════ */

import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { getOrganizerEvents, createEvent, deleteEvent } from '../src/lib/events.js';
import { protectPage, performSignOut } from '../src/lib/guard.js';
import { initUI } from '../src/lib/ui.js';
import { escapeHTML, formatCurrency } from '../src/lib/utils.js';
import { initTabs, initMultiStepForm, initCharts, initAttendees, initSearch } from './dashboard-features.js';

document.addEventListener('DOMContentLoaded', async () => {
  initUI();
  const auth = await protectPage({ requireRole: 'organizer' });
  if (!auth) return;

  document.getElementById('signout-btn').addEventListener('click', () => performSignOut('/index.html'));
  initEventActions();
  initTabs();
  initSearch();

  await loadDashboard();
  initCreateModal();
  checkStripeOnboarding();
});

// ── Stripe Connect Onboarding Check ──
async function checkStripeOnboarding() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const res = await fetch(
      'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/stripe-onboarding',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify({ action: 'check-status' }) }
    );
    if (!res.ok) return;
    const data = await res.json();
    if (!data.onboarding_complete) showStripeOnboardingBanner();
  } catch (e) { console.warn('Stripe status check skipped:', e.message); }
}

function showStripeOnboardingBanner() {
  const banner = document.createElement('div');
  banner.id = 'stripe-banner';
  banner.style.cssText = 'padding:16px 20px;background:rgba(99,91,255,.08);border:1px solid rgba(99,91,255,.2);border-radius:14px;margin-bottom:24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;';
  banner.innerHTML = `
    <div style="width:44px;height:44px;border-radius:12px;background:rgba(99,91,255,.12);display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">💳</div>
    <div style="flex:1;min-width:200px;">
      <div style="font-weight:600;font-size:0.9rem;margin-bottom:2px;">Set Up Payouts</div>
      <div style="font-size:0.8rem;color:var(--text-muted);">Connect your Stripe account to receive ticket sales directly. Takes ~5 minutes.</div>
    </div>
    <button class="btn btn-primary btn-sm" id="stripe-onboard-btn" style="flex-shrink:0;">Connect Stripe →</button>`;
  const statsEl = document.getElementById('dash-stats');
  statsEl?.parentElement?.insertBefore(banner, statsEl);

  document.getElementById('stripe-onboard-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('stripe-onboard-btn');
    btn.disabled = true; btn.textContent = 'Redirecting…';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/stripe-onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'onboard' }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Failed');
    } catch (e) { alert('Failed to start Stripe setup: ' + e.message); btn.disabled = false; btn.textContent = 'Connect Stripe →'; }
  });
}

// ── Delegated event listener ──
function initEventActions() {
  document.getElementById('events-list').addEventListener('click', async (e) => {
    const pubBtn = e.target.closest('[data-action="toggle-publish"]');
    if (pubBtn) {
      const eventId = pubBtn.dataset.eventId;
      const currentStatus = pubBtn.dataset.status;
      const newStatus = currentStatus === 'published' ? 'draft' : 'published';
      pubBtn.disabled = true; pubBtn.textContent = '…';
      try {
        const { error } = await supabase.from('events').update({ status: newStatus }).eq('id', eventId);
        if (error) throw error;
        await loadDashboard();
      } catch (err) { alert('Error: ' + err.message); pubBtn.disabled = false; pubBtn.textContent = currentStatus === 'published' ? 'Unpublish' : 'Publish'; }
      return;
    }
    const delBtn = e.target.closest('[data-action="delete-event"]');
    if (delBtn) showDeleteConfirmModal(delBtn.dataset.eventId, delBtn.dataset.eventTitle, Number(delBtn.dataset.sold || 0));
  });
}

function showDeleteConfirmModal(eventId, eventTitle, soldCount) {
  document.getElementById('delete-confirm-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'delete-confirm-modal';
  modal.innerHTML = `
    <style>
      #delete-confirm-modal { position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease; }
      .delete-box { max-width:420px;width:100%;background:var(--bg-card);border:1px solid rgba(239,68,68,.15);border-radius:20px;padding:28px 24px;box-shadow:0 30px 80px rgba(0,0,0,.4);animation:scaleIn .4s cubic-bezier(.16,1,.3,1) forwards; }
      .delete-box h3 { font-family:var(--font-serif);font-size:1.2rem;font-weight:700;margin-bottom:8px; }
      .delete-box p { color:var(--text-muted);font-size:0.88rem;line-height:1.6;margin-bottom:16px; }
      .delete-event-name { padding:12px 16px;background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.1);border-radius:10px;font-weight:600;font-size:0.9rem;margin-bottom:16px;word-break:break-word; }
      .delete-warning { padding:10px 14px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.12);border-radius:10px;font-size:0.8rem;color:#f59e0b;margin-bottom:20px;display:flex;align-items:center;gap:8px; }
      .delete-btns { display:flex;gap:10px; } .delete-btns .btn { flex:1; }
      .btn-danger { background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;padding:12px 20px;border-radius:12px;font-weight:700;font-size:0.88rem;cursor:pointer;transition:all .2s; }
      .btn-danger:hover { filter:brightness(1.1);transform:translateY(-1px); }
      .btn-danger:disabled { opacity:.5;cursor:not-allowed;transform:none;filter:none; }
    </style>
    <div class="delete-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <div style="width:44px;height:44px;border-radius:12px;background:rgba(239,68,68,.1);display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">🗑️</div>
        <h3>Delete <span style="color:#ef4444;">Event</span></h3>
      </div>
      <p>This action is permanent. All ticket tiers, venue maps, seats, and reservations will be deleted.</p>
      <div class="delete-event-name">📅 ${escapeHTML(eventTitle)}</div>
      ${soldCount > 0 ? `<div class="delete-warning"><span>⚠️</span><span>This event has <strong>${soldCount}</strong> ticket(s) sold. Cancel/refund them first.</span></div>` : ''}
      <div class="delete-btns">
        <button class="btn btn-outline" id="delete-cancel-btn">Cancel</button>
        <button class="btn-danger" id="delete-confirm-btn" ${soldCount > 0 ? 'disabled' : ''}>${soldCount > 0 ? 'Cannot Delete' : 'Delete Permanently'}</button>
      </div>
      <p id="delete-status" style="margin-top:12px;font-size:0.82rem;text-align:center;display:none;"></p>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('delete-cancel-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  if (soldCount === 0) {
    document.getElementById('delete-confirm-btn').addEventListener('click', async () => {
      const btn = document.getElementById('delete-confirm-btn');
      const status = document.getElementById('delete-status');
      btn.disabled = true; btn.innerHTML = 'Deleting…';
      try {
        const result = await deleteEvent(eventId);
        if (result.success) {
          status.textContent = '✓ Event deleted.'; status.style.color = '#22c55e'; status.style.display = 'block';
          setTimeout(async () => { modal.remove(); await loadDashboard(); }, 800);
        } else { status.textContent = '✗ ' + (result.error || 'Failed.'); status.style.color = '#ef4444'; status.style.display = 'block'; btn.disabled = false; btn.textContent = 'Delete Permanently'; }
      } catch (err) { status.textContent = '✗ ' + err.message; status.style.color = '#ef4444'; status.style.display = 'block'; btn.disabled = false; btn.textContent = 'Delete Permanently'; }
    });
  }
}

// ── Load Dashboard ──
async function loadDashboard() {
  const loading = document.getElementById('events-loading');
  const list = document.getElementById('events-list');
  try {
    const user = await getCurrentUser();
    const events = await getOrganizerEvents();
    loading.style.display = 'none';

    const { data: revenueData } = await supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id });
    let totalTickets = 0, totalRevenue = 0, totalScanned = 0;
    if (revenueData) { revenueData.forEach(r => { totalTickets += Number(r.total_tickets_sold); totalRevenue += Number(r.net_revenue); totalScanned += Number(r.scanned_count); }); }
    const scanRate = totalTickets > 0 ? Math.round((totalScanned / totalTickets) * 100) : 0;

    document.getElementById('stat-events').textContent = events.length;
    document.getElementById('stat-tickets').textContent = totalTickets.toLocaleString();
    document.getElementById('stat-revenue').textContent = '$' + totalRevenue.toLocaleString();
    document.getElementById('stat-scan-rate').textContent = totalTickets > 0 ? scanRate + '%' : '—';
    const badge = document.getElementById('tab-events-count');
    if (badge) badge.textContent = events.length;

    if (events.length === 0) {
      list.innerHTML = `<p style="text-align:center;padding:32px 0;color:var(--text-muted);">No events yet. Create your first event!</p>`;
      document.getElementById('revenue-table').innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px;">No revenue data yet.</p>';
      initAttendees([]);
      return;
    }

    list.innerHTML = events.map(event => {
      const date = new Date(event.date);
      const sold = event.ticket_tiers?.reduce((s, t) => s + (t.sold_count || 0), 0) || 0;
      const cap = event.ticket_tiers?.reduce((s, t) => s + t.capacity, 0) || 0;
      return `<div class="dash-event-row">
        <img class="dash-event-img" src="${escapeHTML(event.cover_image) || 'images/event-concert.png'}" alt="" loading="lazy" />
        <div><div class="dash-event-title">${escapeHTML(event.title)}</div><div class="dash-event-date">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div></div>
        <div>${sold} / ${cap} sold</div>
        <div><span class="dash-event-status status-${event.status}">${event.status}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:5px 10px;" data-action="toggle-publish" data-event-id="${event.id}" data-status="${event.status}">${event.status === 'published' ? 'Unpublish' : 'Publish'}</button>
          <a href="venue-designer.html?event_id=${event.id}" class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:5px 10px;">🗺️ Map</a>
          <a href="scanner.html?event=${event.id}" class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:5px 10px;">Scan</a>
          <button class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:5px 10px;color:#ef4444;border-color:rgba(239,68,68,.25);" data-action="delete-event" data-event-id="${event.id}" data-event-title="${escapeHTML(event.title)}" data-sold="${sold}">🗑️ Delete</button>
        </div>
      </div>`;
    }).join('');

    loadRevenueDashboard(revenueData, user.id);
    initCharts(revenueData, events);
    initAttendees(events);
  } catch (err) {
    console.error('Error loading dashboard:', err);
    loading.style.display = 'none';
    list.innerHTML = `<p style="text-align:center;padding:32px 0;color:var(--text-muted);">Connect Supabase to see your events.</p>`;
  }
}

// ── Revenue Dashboard ──
async function loadRevenueDashboard(revenueData, userId) {
  const tableEl = document.getElementById('revenue-table');
  if (!revenueData || revenueData.length === 0) {
    tableEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px;">No revenue data yet.</p>';
    return;
  }
  tableEl.innerHTML = `
    <div class="dash-event-row" style="grid-template-columns:1fr 100px 100px 100px 80px;font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;border-bottom:1px solid var(--border-color);padding-bottom:8px;">
      <div>Event</div><div style="text-align:right;">Gross</div><div style="text-align:right;">Fee (5%)</div><div style="text-align:right;">Net Payout</div><div style="text-align:center;">Scan %</div>
    </div>
    ${revenueData.map(r => `<div class="dash-event-row" style="grid-template-columns:1fr 100px 100px 100px 80px;">
      <div><div class="dash-event-title">${escapeHTML(r.event_title)}</div><div class="dash-event-date">${r.total_tickets_sold} tickets sold</div></div>
      <div style="text-align:right;font-weight:600;font-size:0.85rem;">$${Number(r.gross_revenue).toLocaleString()}</div>
      <div style="text-align:right;color:var(--text-muted);font-size:0.82rem;">-${Number(r.platform_fee).toLocaleString()}</div>
      <div style="text-align:right;color:var(--accent-primary);font-weight:700;font-size:0.85rem;">$${Number(r.net_revenue).toLocaleString()}</div>
      <div style="text-align:center;font-size:0.82rem;">${Number(r.scan_rate)}%</div>
    </div>`).join('')}`;

  const { data: daily } = await supabase.rpc('get_daily_revenue', { p_organizer_id: userId, p_days: 30 });
  if (daily?.length > 0) renderRevenueChart(daily);
}

function renderRevenueChart(data) {
  const maxRevenue = Math.max(...data.map(d => Number(d.revenue)), 1);
  const container = document.getElementById('revenue-chart');
  container.innerHTML = `
    <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;margin-bottom:12px;">Daily Revenue (Last 30 Days)</div>
    <div style="display:flex;gap:2px;height:120px;align-items:flex-end;">
      ${data.map(d => {
        const pct = (Number(d.revenue) / maxRevenue) * 100;
        const day = new Date(d.day).getDate();
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;" title="$${Number(d.revenue).toLocaleString()} · ${d.tickets_sold} tickets">
          <div style="width:100%;background:linear-gradient(to top, var(--accent-primary), rgba(212,175,55,.3));border-radius:4px 4px 0 0;height:${Math.max(pct, 3)}%;min-height:3px;transition:height .3s;"></div>
          <span style="font-size:0.55rem;color:var(--text-muted);">${day}</span>
        </div>`;
      }).join('')}
    </div>`;
}

// ── Create Event Modal ──
let tierCount = 1;

function initCreateModal() {
  const modal = document.getElementById('create-modal');
  document.getElementById('create-event-btn').addEventListener('click', () => modal.style.display = 'flex');
  document.getElementById('create-modal-close').addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  initMultiStepForm();

  // Cover Image Upload
  const fileInput = document.getElementById('ev-cover');
  const uploadArea = document.getElementById('cover-upload-area');
  const placeholder = document.getElementById('cover-placeholder');
  const preview = document.getElementById('cover-preview');
  const previewImg = document.getElementById('cover-preview-img');
  const removeBtn = document.getElementById('cover-remove');
  let selectedFile = null;

  placeholder.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleCoverFile(e.target.files[0]); });
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => { e.preventDefault(); uploadArea.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) handleCoverFile(f); });

  function handleCoverFile(file) {
    if (file.size > 5 * 1024 * 1024) { alert('Image too large. Max 5MB.'); return; }
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => { previewImg.src = e.target.result; preview.style.display = 'block'; placeholder.style.display = 'none'; };
    reader.readAsDataURL(file);
  }
  removeBtn.addEventListener('click', () => { selectedFile = null; fileInput.value = ''; preview.style.display = 'none'; placeholder.style.display = 'flex'; });

  // Add Tier
  document.getElementById('add-tier-btn').addEventListener('click', () => {
    const container = document.getElementById('tiers-container');
    const row = document.createElement('div');
    row.className = 'tier-row'; row.id = `tier-row-${tierCount}`;
    row.innerHTML = `<div class="f-row" style="grid-template-columns:1fr 120px 100px;">
      <div class="fg"><input type="text" class="fi" placeholder="Tier name" data-tier="name" required /></div>
      <div class="fg"><input type="number" class="fi" placeholder="Price" data-tier="price" min="0" required /></div>
      <div class="fg"><input type="number" class="fi" placeholder="Qty" data-tier="capacity" min="1" required /></div>
    </div>`;
    container.appendChild(row); tierCount++;
  });

  // Submit
  document.getElementById('create-event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = await getCurrentUser();
    if (!user) return;
    const eventData = {
      organizer_id: user.id, title: document.getElementById('ev-title').value,
      description: document.getElementById('ev-desc').value, venue: document.getElementById('ev-venue').value,
      venue_address: document.getElementById('ev-address').value, city: document.getElementById('ev-city').value,
      date: new Date(document.getElementById('ev-date').value).toISOString(),
      category: document.getElementById('ev-category').value,
      doors_open: document.getElementById('ev-doors').value || null,
      language: document.getElementById('ev-language').value || 'English',
      terms_conditions: document.getElementById('ev-terms').value || null,
      status: 'published',
    };
    // Add lat/lng if set
    const lat = document.getElementById('ev-lat')?.value;
    const lng = document.getElementById('ev-lng')?.value;
    if (lat && lng) { eventData.latitude = parseFloat(lat); eventData.longitude = parseFloat(lng); }

    try {
      if (selectedFile) {
        const ext = selectedFile.name.split('.').pop();
        const fileName = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('event-covers').upload(fileName, selectedFile, { cacheControl: '3600', upsert: false, contentType: selectedFile.type });
        if (uploadError) { alert('Failed to upload image: ' + uploadError.message); return; }
        const { data: { publicUrl } } = supabase.storage.from('event-covers').getPublicUrl(fileName);
        eventData.cover_image = publicUrl;
      }
      const event = await createEvent(eventData);
      const tierRows = document.querySelectorAll('.tier-row');
      for (const row of tierRows) {
        const name = row.querySelector('[data-tier="name"]').value;
        const price = parseFloat(row.querySelector('[data-tier="price"]').value) || 0;
        const capacity = parseInt(row.querySelector('[data-tier="capacity"]').value) || 100;
        if (name) { await supabase.from('ticket_tiers').insert({ event_id: event.id, name, price, capacity }); }
      }
      modal.style.display = 'none';
      await loadDashboard();
    } catch (err) { alert('Error creating event: ' + err.message); }
  });
}
