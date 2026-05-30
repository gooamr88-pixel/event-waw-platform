/* ═══════════════════════════════════════════════════
   EVENTSLI ATTENDEE DASHBOARD — Enhanced Controller
   ES Module — Supabase-powered
   ═══════════════════════════════════════════════════ */

import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { protectPage, performSignOut, upgradeToOrganizer } from '../src/lib/guard.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { escapeHTML, formatCurrency } from '../src/lib/utils.js';

/* ━━━ State ━━━ */
let _orders = [];
let _tickets = [];
let _profile = null;
let _user = null;

/* ━━━ Init ━━━ */
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await protectPage();
  if (!auth) return;

  _user = auth.user;
  _profile = auth.profile;

  setupThemeToggle();
  setupSidebar();
  setupSignOut();
  setupUserInfo();
  setupUpgradeCTA();
  setupQuickActions();

  await loadDashboardData();
  setupProfileForm();
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   THEME TOGGLE
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  const apply = (theme) => {
    document.body.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  };

  apply(localStorage.getItem('theme') || 'light');

  btn.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') || 'light';
    apply(current === 'dark' ? 'light' : 'dark');
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SIDEBAR NAVIGATION
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setupSidebar() {
  const navItems = document.querySelectorAll('.ev-nav-item[data-panel]');
  const panels = document.querySelectorAll('.ev-panel');
  const headerTitle = document.getElementById('header-title');

  const titles = {
    overview: 'Dashboard',
    'my-events': 'My Events',
    tickets: 'My Tickets',
    orders: 'Order History',
    profile: 'My Profile'
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      switchPanel(item.dataset.panel);
    });
  });

  window._switchPanel = switchPanel; // expose for quick actions

  function switchPanel(target) {
    navItems.forEach(n => n.classList.remove('active'));
    const activeNav = document.querySelector(`.ev-nav-item[data-panel="${target}"]`);
    if (activeNav) activeNav.classList.add('active');

    panels.forEach(p => {
      const match = p.id === `panel-${target}`;
      p.classList.toggle('active', match);
      p.style.display = match ? '' : 'none';
    });
    if (headerTitle) headerTitle.textContent = titles[target] || 'Dashboard';

    // Close mobile sidebar
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('open');

    // Scroll to top
    document.querySelector('.ev-main')?.scrollTo(0, 0);
  }

  // Mobile toggle
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('open');
  });
  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('open');
  });

  // Initial visibility
  panels.forEach(p => {
    if (!p.classList.contains('active')) p.style.display = 'none';
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   QUICK ACTIONS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setupQuickActions() {
  document.getElementById('action-orders')?.addEventListener('click', (e) => {
    e.preventDefault();
    window._switchPanel('orders');
  });
  document.getElementById('action-profile')?.addEventListener('click', (e) => {
    e.preventDefault();
    window._switchPanel('profile');
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SIGN OUT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setupSignOut() {
  document.getElementById('sign-out-btn')?.addEventListener('click', () => {
    performSignOut('/index.html');
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   USER INFO
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setupUserInfo() {
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const welcomeEl = document.getElementById('welcome-name');
  const avatarEl = document.getElementById('user-avatar');

  const displayName = _profile?.full_name || _profile?.email?.split('@')[0] || 'User';
  const firstName = displayName.split(' ')[0];

  if (nameEl) nameEl.textContent = displayName;
  if (roleEl) roleEl.textContent = _profile?.role === 'organizer' ? 'Organizer' : 'Attendee';
  if (welcomeEl) welcomeEl.textContent = firstName;

  if (avatarEl && _profile?.avatar_url) {
    setSafeHTML(avatarEl, `<img src="${escapeHTML(_profile.avatar_url)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   UPGRADE CTA
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setupUpgradeCTA() {
  const cta = document.getElementById('upgrade-cta');
  if (!cta) return;

  if (_profile?.role === 'organizer' || _profile?.role === 'admin') {
    setSafeHTML(cta, `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
      Organizer Dashboard
    `);
    cta.href = 'dashboard.html';
  } else {
    cta.addEventListener('click', async (e) => {
      e.preventDefault();
      cta.innerHTML = '<div style="display:flex;align-items:center;gap:6px;"><div class="guard-spinner" style="width:14px;height:14px;border-width:2px;"></div> Upgrading...</div>';
      cta.style.pointerEvents = 'none';
      const ok = await upgradeToOrganizer();
      if (ok) {
        cta.textContent = '✓ Upgraded! Redirecting...';
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
      } else {
        cta.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Try Again';
        cta.style.pointerEvents = '';
        setTimeout(() => {
          cta.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Become an Organizer';
        }, 2000);
      }
    });
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LOAD DATA
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function loadDashboardData() {
  try {
    const [ordersRes, ticketsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*, events(*)')
        .eq('user_id', _user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('tickets')
        .select(`
          *,
          orders(id, amount, status, created_at),
          ticket_tiers(
            id, name, price,
            events(id, title, cover_image, venue, venue_address, date, status)
          )
        `)
        .eq('user_id', _user.id)
        .order('created_at', { ascending: false })
    ]);

    _orders = ordersRes.data || [];
    _tickets = ticketsRes.data || [];

    renderStats();
    renderUpcomingEvents();
    renderAllEvents();
    renderRecentTickets();
    renderAllTickets();
    renderOrdersTable();

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STATS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderStats() {
  const now = new Date();
  const upcomingSet = new Set();
  const pastSet = new Set();
  let totalSpent = 0;

  _orders.forEach(o => {
    if (o.status === 'completed' || o.status === 'paid') {
      totalSpent += (o.total_amount || o.amount || 0);
    }
    const d = o.events?.date ? new Date(o.events.date) : null;
    if (d) {
      if (d >= now) upcomingSet.add(o.event_id);
      else pastSet.add(o.event_id);
    }
  });

  animateCounter('stat-total-tickets', _tickets.length);
  animateCounter('stat-upcoming', upcomingSet.size);
  animateCounter('stat-past', pastSet.size);

  const spentEl = document.getElementById('stat-spent');
  if (spentEl) spentEl.textContent = formatCurrency ? formatCurrency(totalSpent) : `$${totalSpent.toFixed(2)}`;
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  if (target === 0) { el.textContent = '0'; return; }

  let current = 0;
  const step = Math.max(1, Math.ceil(target / 20));
  const interval = setInterval(() => {
    current += step;
    if (current >= target) {
      current = target;
      clearInterval(interval);
    }
    el.textContent = current;
  }, 40);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   EVENT CARDS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function getCountdown(dateStr) {
  const now = new Date();
  const target = new Date(dateStr);
  const diff = target - now;
  if (diff <= 0) return null;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 30) return `${Math.ceil(days / 30)} months away`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} away`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h left`;
  return 'Starting soon!';
}

function buildEventCard(ev, eventId) {
  const coverUrl = ev.cover_image || 'images/event-placeholder.png';
  const dateStr = ev.date ? new Date(ev.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'TBD';
  const location = [ev.venue, ev.city].filter(Boolean).join(', ') || 'Online';
  const countdown = ev.date ? getCountdown(ev.date) : null;

  return `
    <div class="att-event-card" data-event-id="${escapeHTML(eventId)}" onclick="window.location.href='event-detail.html?id=${escapeHTML(eventId)}'">
      <div class="att-event-cover">
        <img src="${escapeHTML(coverUrl)}" alt="${escapeHTML(ev.title || '')}" loading="lazy" />
        <div class="att-event-cover-overlay"></div>
        <div class="att-event-date-badge">${escapeHTML(dateStr)}</div>
        ${countdown ? `<div class="att-event-countdown">⏱ ${escapeHTML(countdown)}</div>` : ''}
      </div>
      <div class="att-event-body">
        <div class="att-event-title">${escapeHTML(ev.title || 'Untitled Event')}</div>
        <div class="att-event-meta">
          <div class="att-event-meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
            ${escapeHTML(location)}
          </div>
        </div>
        <div class="att-event-actions">
          <a href="my-tickets.html" class="att-event-action-btn primary" onclick="event.stopPropagation()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg>
            View Ticket
          </a>
          <a href="event-detail.html?id=${escapeHTML(eventId)}" class="att-event-action-btn secondary" onclick="event.stopPropagation()">
            Details →
          </a>
        </div>
      </div>
    </div>
  `;
}

function renderUpcomingEvents() {
  const grid = document.getElementById('upcoming-events-grid');
  if (!grid) return;
  const now = new Date();

  const upcoming = deduplicateOrders(_orders.filter(o => {
    const d = o.events?.date ? new Date(o.events.date) : null;
    return d && d >= now;
  }));

  if (!upcoming.length) {
    grid.innerHTML = `
      <div class="att-empty-state" style="grid-column:1/-1;">
        <div class="att-empty-icon">🎪</div>
        <div class="att-empty-title">No upcoming events</div>
        <div class="att-empty-desc">You haven't registered for any upcoming events yet. Explore what's happening near you!</div>
        <a href="events.html" class="att-empty-btn">🔍 Browse Events</a>
      </div>
    `;
    return;
  }

  grid.innerHTML = upcoming.map(o => buildEventCard(o.events, o.event_id)).join('');
}

function renderAllEvents() {
  const grid = document.getElementById('all-events-grid');
  if (!grid) return;

  const allUnique = deduplicateOrders(_orders.filter(o => o.events));

  if (!allUnique.length) {
    grid.innerHTML = `
      <div class="att-empty-state" style="grid-column:1/-1;">
        <div class="att-empty-icon">📅</div>
        <div class="att-empty-title">No events yet</div>
        <div class="att-empty-desc">When you purchase tickets, your events will appear here.</div>
        <a href="events.html" class="att-empty-btn">🔍 Discover Events</a>
      </div>
    `;
    return;
  }

  grid.innerHTML = allUnique.map(o => buildEventCard(o.events, o.event_id)).join('');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TICKET CARDS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function buildTicketCard(ticket) {
  const tier = ticket.ticket_tiers;
  const ev = tier?.events;
  const eventDate = ev?.date ? new Date(ev.date) : null;
  const month = eventDate ? eventDate.toLocaleDateString('en-US', { month: 'short' }) : '—';
  const day = eventDate ? eventDate.getDate() : '—';
  const statusClass = ticket.scanned_at ? 'used' : ticket.status === 'cancelled' ? 'cancelled' : 'valid';
  const statusText = ticket.scanned_at ? 'Used' : ticket.status === 'cancelled' ? 'Cancelled' : 'Valid';

  return `
    <div class="att-ticket-card">
      <div class="att-ticket-left">
        <div class="att-ticket-month">${escapeHTML(month)}</div>
        <div class="att-ticket-day">${escapeHTML(String(day))}</div>
      </div>
      <div class="att-ticket-right">
        <div class="att-ticket-event">${escapeHTML(ev?.title || 'Unknown Event')}</div>
        <div class="att-ticket-tier">${escapeHTML(tier?.name || 'General')} ${tier?.price ? `• ${formatCurrency ? formatCurrency(tier.price) : '$' + tier.price}` : '• Free'}</div>
        <div><span class="att-ticket-status ${statusClass}">${escapeHTML(statusText)}</span></div>
      </div>
    </div>
  `;
}

function renderRecentTickets() {
  const list = document.getElementById('recent-tickets-list');
  if (!list) return;

  const recent = _tickets.slice(0, 3);
  if (!recent.length) {
    list.innerHTML = `
      <div class="att-empty-state">
        <div class="att-empty-icon">🎫</div>
        <div class="att-empty-title">No tickets yet</div>
        <div class="att-empty-desc">Your purchased tickets will show up here with QR codes for event entry.</div>
        <a href="events.html" class="att-empty-btn">Get Tickets</a>
      </div>
    `;
    return;
  }

  list.innerHTML = recent.map(t => buildTicketCard(t)).join('');
}

function renderAllTickets() {
  const list = document.getElementById('all-tickets-list');
  if (!list) return;

  if (!_tickets.length) {
    list.innerHTML = `
      <div class="att-empty-state">
        <div class="att-empty-icon">🎫</div>
        <div class="att-empty-title">No tickets yet</div>
        <div class="att-empty-desc">Purchase a ticket from any event and it will appear here.</div>
        <a href="events.html" class="att-empty-btn">Browse Events</a>
      </div>
    `;
    return;
  }

  list.innerHTML = _tickets.map(t => buildTicketCard(t)).join('');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ORDERS TABLE
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderOrdersTable() {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  if (!_orders.length) {
    setSafeHTML(tbody, `<tr><td colspan="6" class="ev-table-empty">
      No orders found. <a href="events.html" style="color:#059669;font-weight:600;">Browse events</a> to get started!
    </td></tr>`);
    return;
  }

  tbody.innerHTML = '';
  _orders.forEach((o, i) => {
    const tr = document.createElement('tr');
    const dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const rawAmount = o.total_amount ?? o.amount;
    const amount = rawAmount != null ? (formatCurrency ? formatCurrency(rawAmount, o.currency) : `$${Number(rawAmount).toFixed(2)}`) : 'Free';
    const statusClass = o.status === 'completed' || o.status === 'paid' ? 'ev-badge-success' : o.status === 'cancelled' ? 'ev-badge-danger' : 'ev-badge-warning';
    const statusText = o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Unknown';
    const eventTitle = o.events?.title || 'Unknown Event';

    // Count tickets for this order
    const orderTickets = _tickets.filter(t => t.event_id === o.event_id).length;

    setSafeHTML(tr, `
      <td style="font-weight:600;color:var(--ev-text-muted);font-size:.82rem;">${i + 1}</td>
      <td style="font-weight:600;">${escapeHTML(eventTitle)}</td>
      <td>${orderTickets || '—'}</td>
      <td style="font-weight:600;">${escapeHTML(amount)}</td>
      <td><span class="ev-badge ${statusClass}">${escapeHTML(statusText)}</span></td>
      <td style="color:var(--ev-text-muted);font-size:.82rem;">${escapeHTML(dateStr)}</td>
    `);
    tbody.appendChild(tr);
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PROFILE FORM
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setupProfileForm() {
  const nameInput = document.getElementById('profile-name');
  const emailInput = document.getElementById('profile-email');
  const phoneInput = document.getElementById('profile-phone');
  const form = document.getElementById('profile-form');
  const msg = document.getElementById('profile-msg');
  const displayName = document.getElementById('profile-display-name');
  const displayEmail = document.getElementById('profile-display-email');
  const avatarLg = document.getElementById('profile-avatar-lg');

  if (nameInput) nameInput.value = _profile?.full_name || '';
  if (emailInput) emailInput.value = _profile?.email || _user?.email || '';
  if (phoneInput) phoneInput.value = _profile?.phone || '';
  if (displayName) displayName.textContent = _profile?.full_name || 'Your Name';
  if (displayEmail) displayEmail.textContent = _profile?.email || _user?.email || '';

  // Profile avatar
  if (avatarLg && _profile?.avatar_url) {
    setSafeHTML(avatarLg, `<img src="${escapeHTML(_profile.avatar_url)}" alt="Avatar" />`);
  } else if (avatarLg && _profile?.full_name) {
    avatarLg.textContent = _profile.full_name.charAt(0).toUpperCase();
    avatarLg.querySelector('svg')?.remove();
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('profile-save');
    const origHTML = saveBtn?.innerHTML;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<div class="guard-spinner" style="width:14px;height:14px;border-width:2px;"></div> Saving...';
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: nameInput?.value?.trim() || '',
          phone: phoneInput?.value?.trim() || ''
        })
        .eq('id', _user.id);

      if (error) throw error;

      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#059669';
        msg.style.background = 'rgba(5,150,105,.06)';
        msg.textContent = '✓ Profile updated successfully!';
      }

      // Update all name displays
      const newName = nameInput?.value?.trim();
      if (newName) {
        document.getElementById('user-name')?.replaceChildren(document.createTextNode(newName));
        document.getElementById('welcome-name')?.replaceChildren(document.createTextNode(newName.split(' ')[0]));
        if (displayName) displayName.textContent = newName;
      }

    } catch (err) {
      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#ef4444';
        msg.style.background = 'rgba(239,68,68,.06)';
        msg.textContent = 'Failed to update: ' + (err.message || 'Unknown error');
      }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origHTML; }
      setTimeout(() => { if (msg) msg.style.display = 'none'; }, 3000);
    }
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPERS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function deduplicateOrders(orders) {
  const seen = new Set();
  return orders.filter(o => {
    if (seen.has(o.event_id)) return false;
    seen.add(o.event_id);
    return true;
  });
}
