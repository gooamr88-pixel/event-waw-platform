/* ===================================
   EVENTSLI ATTENDEE DASHBOARD - Controller
   ES Module — Fetches real data from Supabase
   =================================== */

import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { protectPage, performSignOut, upgradeToOrganizer } from '../src/lib/guard.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { escapeHTML, formatCurrency } from '../src/lib/utils.js';

/* ── Init ── */
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await protectPage(); // No role requirement — any authenticated user
  if (!auth) return;

  const { user, profile } = auth;

  setupThemeToggle();
  setupSidebar();
  setupSignOut();
  setupUserInfo(profile);
  loadDashboardData(user, profile);
  setupProfileForm(user, profile);
  setupUpgradeCTA(profile);
});

/* ── Theme Toggle ── */
function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  const apply = (theme) => {
    document.body.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  };

  // Apply saved theme
  const saved = localStorage.getItem('theme') || 'light';
  apply(saved);

  btn.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') || 'light';
    apply(current === 'dark' ? 'light' : 'dark');
  });
}

/* ── Sidebar Nav ── */
function setupSidebar() {
  const navItems = document.querySelectorAll('.ev-nav-item[data-panel]');
  const panels = document.querySelectorAll('.ev-panel');
  const headerTitle = document.getElementById('header-title');

  const titles = {
    events: 'Dashboard',
    tickets: 'My Tickets',
    orders: 'Order History',
    profile: 'My Profile'
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.panel;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      panels.forEach(p => {
        p.classList.toggle('active', p.id === `panel-${target}`);
        p.style.display = p.id === `panel-${target}` ? '' : 'none';
      });
      if (headerTitle) headerTitle.textContent = titles[target] || 'Dashboard';

      // Close mobile sidebar
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.remove('open');
    });
  });

  // Mobile toggle
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay?.classList.toggle('open');
    });
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar?.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // Set initial panel visibility
  panels.forEach(p => {
    if (!p.classList.contains('active')) p.style.display = 'none';
  });
}

/* ── Sign Out ── */
function setupSignOut() {
  document.getElementById('sign-out-btn')?.addEventListener('click', () => {
    performSignOut('/index.html');
  });
}

/* ── User Info ── */
function setupUserInfo(profile) {
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const welcomeEl = document.getElementById('welcome-name');
  const avatarEl = document.getElementById('user-avatar');

  const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'User';
  const firstName = displayName.split(' ')[0];

  if (nameEl) nameEl.textContent = displayName;
  if (roleEl) roleEl.textContent = profile?.role === 'organizer' ? 'Organizer' : 'Attendee';
  if (welcomeEl) welcomeEl.textContent = firstName;

  if (avatarEl && profile?.avatar_url) {
    setSafeHTML(avatarEl, `<img src="${escapeHTML(profile.avatar_url)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`);
  }
}

/* ── Upgrade CTA ── */
function setupUpgradeCTA(profile) {
  const cta = document.getElementById('upgrade-cta');
  if (!cta) return;

  if (profile?.role === 'organizer' || profile?.role === 'admin') {
    cta.textContent = '📋 Go to Organizer Dashboard';
    cta.href = 'dashboard.html';
  } else {
    cta.addEventListener('click', async (e) => {
      e.preventDefault();
      cta.textContent = 'Upgrading...';
      cta.style.pointerEvents = 'none';
      const ok = await upgradeToOrganizer();
      if (ok) {
        cta.textContent = '✓ Upgraded! Redirecting...';
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
      } else {
        cta.textContent = 'Upgrade failed. Try again.';
        cta.style.pointerEvents = '';
        setTimeout(() => { cta.textContent = '⚡ Become an Organizer'; }, 2000);
      }
    });
  }
}

/* ── Dashboard Data ── */
async function loadDashboardData(user, profile) {
  try {
    // Fetch orders
    const { data: orders } = await supabase
      .from('orders')
      .select('id, event_id, total_amount, currency, status, created_at, events(title, date, end_date, venue, city, country, cover_url, status)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    // Fetch tickets
    const { data: tickets } = await supabase
      .from('tickets')
      .select('id, event_id, status, scanned_at, ticket_tiers(name, price, currency)')
      .eq('user_id', user.id);

    const now = new Date();
    const safeOrders = orders || [];
    const safeTickets = tickets || [];

    // Compute stats
    const totalTickets = safeTickets.length;
    const upcomingEvents = new Set();
    const pastEvents = new Set();
    let totalSpent = 0;

    safeOrders.forEach(o => {
      if (o.status === 'completed' || o.status === 'paid') {
        totalSpent += (o.total_amount || 0);
      }
      const eventDate = o.events?.date ? new Date(o.events.date) : null;
      if (eventDate) {
        if (eventDate >= now) upcomingEvents.add(o.event_id);
        else pastEvents.add(o.event_id);
      }
    });

    // Render stats
    document.getElementById('stat-total-tickets').textContent = totalTickets;
    document.getElementById('stat-upcoming').textContent = upcomingEvents.size;
    document.getElementById('stat-past').textContent = pastEvents.size;
    document.getElementById('stat-spent').textContent = formatCurrency ? formatCurrency(totalSpent) : `$${totalSpent.toFixed(2)}`;

    // Render upcoming events
    renderUpcomingEvents(safeOrders.filter(o => {
      const d = o.events?.date ? new Date(o.events.date) : null;
      return d && d >= now;
    }));

    // Render orders table
    renderOrdersTable(safeOrders);

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}

/* ── Upcoming Events Grid ── */
function renderUpcomingEvents(upcomingOrders) {
  const grid = document.getElementById('upcoming-events-grid');
  if (!grid) return;

  if (!upcomingOrders.length) {
    setSafeHTML(grid, `
      <div style="grid-column:1/-1;text-align:center;padding:40px;">
        <div style="width:60px;height:60px;margin:0 auto 16px;border-radius:50%;background:rgba(5,150,105,.06);border:1px solid rgba(5,150,105,.12);display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🎪</div>
        <p style="color:var(--ev-text-muted);margin-bottom:16px;">No upcoming events yet.</p>
        <a href="events.html" style="color:#059669;font-weight:600;text-decoration:none;">Browse Events →</a>
      </div>
    `);
    return;
  }

  // Deduplicate by event_id
  const seen = new Set();
  const unique = upcomingOrders.filter(o => {
    if (seen.has(o.event_id)) return false;
    seen.add(o.event_id);
    return true;
  });

  grid.innerHTML = '';
  unique.forEach(o => {
    const ev = o.events;
    if (!ev) return;
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--ev-border);border-radius:16px;overflow:hidden;background:var(--ev-bg);transition:transform .2s,box-shadow .2s;cursor:pointer;';
    card.onmouseenter = () => { card.style.transform='translateY(-2px)'; card.style.boxShadow='0 8px 24px rgba(0,0,0,.12)'; };
    card.onmouseleave = () => { card.style.transform=''; card.style.boxShadow=''; };

    const coverUrl = ev.cover_url || 'images/event-placeholder.png';
    const dateStr = ev.date ? new Date(ev.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
    const location = [ev.venue, ev.city, ev.country].filter(Boolean).join(', ');

    setSafeHTML(card, `
      <div style="height:140px;background:linear-gradient(180deg,transparent 40%,rgba(0,0,0,.6)),url('${escapeHTML(coverUrl)}') center/cover no-repeat;display:flex;align-items:flex-end;padding:12px;">
        <span style="background:rgba(5,150,105,.9);color:#fff;font-size:.7rem;font-weight:700;padding:4px 10px;border-radius:6px;">${escapeHTML(dateStr)}</span>
      </div>
      <div style="padding:14px;">
        <h4 style="font-size:.92rem;font-weight:700;margin-bottom:6px;line-height:1.4;">${escapeHTML(ev.title || 'Untitled Event')}</h4>
        <p style="font-size:.78rem;color:var(--ev-text-muted);display:flex;align-items:center;gap:4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
          ${escapeHTML(location || 'Online')}
        </p>
      </div>
    `);

    card.addEventListener('click', () => {
      window.location.href = `event-detail.html?id=${o.event_id}`;
    });

    grid.appendChild(card);
  });
}

/* ── Orders Table ── */
function renderOrdersTable(orders) {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  if (!orders.length) {
    setSafeHTML(tbody, '<tr><td colspan="5" class="ev-table-empty">No orders found. <a href="events.html" style="color:#059669;">Browse events</a> to get started!</td></tr>');
    return;
  }

  tbody.innerHTML = '';
  orders.forEach((o, i) => {
    const tr = document.createElement('tr');
    const dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const amount = o.total_amount != null ? (formatCurrency ? formatCurrency(o.total_amount, o.currency) : `$${o.total_amount.toFixed(2)}`) : 'Free';
    const statusClass = o.status === 'completed' || o.status === 'paid' ? 'ev-badge-success' : o.status === 'cancelled' ? 'ev-badge-danger' : 'ev-badge-warning';
    const statusText = o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Unknown';
    const eventTitle = o.events?.title || 'Unknown Event';

    setSafeHTML(tr, `
      <td>${i + 1}</td>
      <td>${escapeHTML(eventTitle)}</td>
      <td>${escapeHTML(amount)}</td>
      <td><span class="ev-badge ${statusClass}">${escapeHTML(statusText)}</span></td>
      <td>${escapeHTML(dateStr)}</td>
    `);
    tbody.appendChild(tr);
  });
}

/* ── Profile Form ── */
function setupProfileForm(user, profile) {
  const nameInput = document.getElementById('profile-name');
  const emailInput = document.getElementById('profile-email');
  const phoneInput = document.getElementById('profile-phone');
  const form = document.getElementById('profile-form');
  const msg = document.getElementById('profile-msg');

  if (nameInput) nameInput.value = profile?.full_name || '';
  if (emailInput) emailInput.value = profile?.email || user?.email || '';
  if (phoneInput) phoneInput.value = profile?.phone || '';

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('profile-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: nameInput?.value?.trim() || '',
          phone: phoneInput?.value?.trim() || ''
        })
        .eq('id', user.id);

      if (error) throw error;

      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#059669';
        msg.textContent = '✓ Profile updated successfully!';
      }
      // Update header name
      const nameEl = document.getElementById('user-name');
      const welcomeEl = document.getElementById('welcome-name');
      const newName = nameInput?.value?.trim();
      if (nameEl && newName) nameEl.textContent = newName;
      if (welcomeEl && newName) welcomeEl.textContent = newName.split(' ')[0];
    } catch (err) {
      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#ef4444';
        msg.textContent = 'Failed to update profile. ' + (err.message || '');
      }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
      setTimeout(() => { if (msg) msg.style.display = 'none'; }, 3000);
    }
  });
}
