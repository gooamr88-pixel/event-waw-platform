/* ===================================
   EVENT WAW — Admin Motherboard Controller
   ===================================
   Orchestrates the Super Admin Dashboard.
   Guards access to admin role only.
   Manages panel switching, clock, sign-out,
   and delegates to sub-modules in Phase 3.
   =================================== */

import { supabase } from '../src/lib/supabase.js';
import { renderCMSEditor } from '../src/lib/admin-cms.js';
import { protectPage, performSignOut } from '../src/lib/guard.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { escapeHTML } from '../src/lib/utils.js';

let currentPanel = 'dashboard';

/* ══════════════════════════════════════
   INIT
   ══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // ── Strict admin gate ──
  const auth = await protectPage({ requireRole: 'admin' });
  if (!auth) return;

  // ── Apply saved theme ──
  applyTheme();

  // ── Setup UI ──
  setupUserInfo(auth);
  setupNavigation();
  setupMobileToggle();
  setupSignOut();
  setupClock();
  setupDarkMode();
  setupCMSEvents();
  setupHeaderShortcuts();
  setupUserDropdown();

  // ── Load initial data ──
  await loadDashboardData();
});

/* ══════════════════════════════════════
   THEME
   ══════════════════════════════════════ */

function applyTheme() {
  const saved = localStorage.getItem('theme');
  const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = isDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
}

function setupDarkMode() {
  const toggle = document.getElementById('dark-mode-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
}

/* ══════════════════════════════════════
   USER INFO
   ══════════════════════════════════════ */

function setupUserInfo(auth) {
  const { profile } = auth;
  const name = profile?.full_name || profile?.email?.split('@')[0] || 'Admin';
  const email = profile?.email || 'admin@eventwaw.com';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('user-avatar');
  const welcomeEl = document.getElementById('welcome-name');
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = initials;
  if (welcomeEl) welcomeEl.textContent = name.split(' ')[0];
}

/* ══════════════════════════════════════
   NAVIGATION — Panel Switching
   ══════════════════════════════════════ */

function setupNavigation() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.addEventListener('click', (e) => {
    const item = e.target.closest('.ev-nav-item[data-panel]');
    if (!item) return;

    const panelId = item.dataset.panel;
    if (panelId === currentPanel) return;

    switchPanel(panelId);
  });
}

function switchPanel(panelId) {
  // Deactivate current nav + panel
  document.querySelector('.ev-nav-item.active')?.classList.remove('active');
  document.querySelector('.ev-panel.active')?.classList.remove('active');

  // Activate new nav + panel
  const navItem = document.querySelector(`.ev-nav-item[data-panel="${panelId}"]`);
  const panel = document.getElementById(`panel-${panelId}`);
  if (navItem) navItem.classList.add('active');
  if (panel) panel.classList.add('active');

  currentPanel = panelId;

  // Close mobile sidebar on panel switch
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');

  // Trigger lazy data loading for the activated panel
  loadPanelData(panelId);
}

/* ══════════════════════════════════════
   HEADER SHORTCUTS — Quick panel links
   ══════════════════════════════════════ */

function setupHeaderShortcuts() {
  document.querySelectorAll('.ev-header-link[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      if (panelId !== currentPanel) switchPanel(panelId);
    });
  });
}

/* ══════════════════════════════════════
   USER DROPDOWN
   ══════════════════════════════════════ */

function setupUserDropdown() {
  const userWrap = document.getElementById('user-wrap');
  const userInfo = document.getElementById('user-info');
  if (!userWrap || !userInfo) return;

  userInfo.addEventListener('click', () => {
    userWrap.classList.toggle('open');
    userInfo.setAttribute('aria-expanded', userWrap.classList.contains('open'));
  });

  document.addEventListener('click', (e) => {
    if (!userWrap.contains(e.target)) {
      userWrap.classList.remove('open');
      userInfo.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ══════════════════════════════════════
   MOBILE SIDEBAR TOGGLE
   ══════════════════════════════════════ */

function setupMobileToggle() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay?.classList.toggle('active');
  });

  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;
    if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
      sidebar.classList.remove('open');
      overlay?.classList.remove('active');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      overlay?.classList.remove('active');
    }
  });
}

/* ══════════════════════════════════════
   SIGN OUT
   ══════════════════════════════════════ */

function setupSignOut() {
  // Sidebar sign-out button
  document.getElementById('signout-btn')?.addEventListener('click', async () => {
    if (confirm('Sign out of the Admin Console?')) {
      await performSignOut('/login.html');
    }
  });
  // Dropdown sign-out button
  document.getElementById('dropdown-signout')?.addEventListener('click', async () => {
    if (confirm('Sign out of the Admin Console?')) {
      await performSignOut('/login.html');
    }
  });
}

/* ══════════════════════════════════════
   LIVE CLOCK
   ══════════════════════════════════════ */

function setupClock() {
  const el = document.getElementById('admin-clock');
  const heroEl = document.getElementById('admin-clock-hero');

  const tick = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }) + ' · ' + now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    if (el) el.textContent = timeStr;
    if (heroEl) heroEl.textContent = timeStr;
  };

  tick();
  setInterval(tick, 1000);
}

/* ══════════════════════════════════════
   DATA LOADING — Dashboard Stats
   ══════════════════════════════════════ */

async function loadDashboardData() {
  try {
    const { data, error } = await supabase.rpc('admin_get_platform_stats');

    if (error) {
      console.error('Failed to load platform stats:', error);
      showToast('Failed to load dashboard data', 'error');
      return;
    }

    if (data && data.length > 0) {
      const stats = data[0];
      animateStat('stat-users',      stats.total_users);
      animateStat('stat-organizers',  stats.total_organizers);
      animateStat('stat-events',     stats.total_events);
      animateStat('stat-pending',    stats.pending_approval);
      animateStat('stat-revenue',    stats.total_revenue, '$');
      animateStat('stat-tickets',    stats.total_tickets);

      // Update nav badge
      const badge = document.getElementById('pending-count');
      if (badge && stats.pending_approval > 0) {
        badge.textContent = stats.pending_approval;
        badge.style.display = '';
      }
    }

    // Activity placeholder
    const actEl = document.getElementById('admin-activity');
    if (actEl) {
      setSafeHTML(actEl, `
        <div style="text-align:center;padding:40px 20px;color:var(--ev-text-muted)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px;margin:0 auto 12px;display:block;opacity:.4"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <h3 style="font-size:.95rem;font-weight:700;color:var(--ev-text);margin-bottom:6px">Dashboard Ready</h3>
          <p style="font-size:.82rem">Platform statistics loaded. Select a panel from the sidebar to manage events, users, or CMS content.</p>
        </div>
      `);
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
    showToast('Dashboard load failed: ' + err.message, 'error');
  }
}

/* ══════════════════════════════════════
   LAZY PANEL DATA LOADING
   Phase 3 will plug real loaders here.
   ══════════════════════════════════════ */

const loadedPanels = new Set(['dashboard']);

async function loadPanelData(panelId) {
  if (loadedPanels.has(panelId)) return;
  loadedPanels.add(panelId);

  switch (panelId) {
    case 'approvals':
      await loadApprovalQueue();
      break;
    case 'users':
      await loadAllUsers();
      break;
    case 'events-all':
      await loadAllEvents();
      break;
    case 'cms':
      await loadCMSPanel();
      break;
  }
}

/* ── Approval Queue (Phase 3 stub with real query) ── */

async function loadApprovalQueue() {
  const tbody = document.getElementById('approvals-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, category, date, created_at, status, admin_approved, admin_rejected_reason, organizer_id, profiles!events_organizer_id_fkey(full_name, email)')
      .eq('status', 'published')
      .eq('admin_approved', false)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No events pending approval — all clear ✓</td></tr>');
      return;
    }

    setSafeHTML(tbody, data.map((ev, i) => {
      const org = ev.profiles || {};
      const date = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const submitted = new Date(ev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<tr>
        <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
        <td style="font-weight:600;color:var(--ev-text)">${escapeHTML(ev.title)}</td>
        <td>${escapeHTML(org.full_name || org.email || '—')}</td>
        <td>${date}</td>
        <td>${escapeHTML(ev.category || '—')}</td>
        <td>${submitted}</td>
        <td><span class="ev-badge pending">Pending</span></td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="ev-btn ev-btn-pink" style="padding:5px 12px;font-size:.75rem" data-approve="${ev.id}">Approve</button>
            <button class="ev-btn ev-btn-danger" style="padding:5px 12px;font-size:.75rem" data-reject="${ev.id}" data-title="${escapeHTML(ev.title)}">Reject</button>
          </div>
        </td>
      </tr>`;
    }).join(''));

    // Wire approval buttons
    tbody.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => handleApprove(btn.dataset.approve));
    });
    tbody.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => handleReject(btn.dataset.reject, btn.dataset.title));
    });
  } catch (err) {
    console.error('loadApprovalQueue error:', err);
    setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

async function handleApprove(eventId) {
  if (!confirm('Approve this event for public listing?')) return;
  try {
    const { error } = await supabase.rpc('admin_approve_event', { p_event_id: eventId });
    if (error) throw error;
    showToast('Event approved and now live!', 'success');
    loadedPanels.delete('approvals');
    loadedPanels.delete('dashboard');
    loadedPanels.delete('events-all');
    await loadApprovalQueue();
    await loadDashboardData();
  } catch (err) {
    showToast('Approve failed: ' + err.message, 'error');
  }
}

async function handleReject(eventId, title) {
  const reason = prompt(`Reject "${title}"?\n\nEnter rejection reason (required):`);
  if (!reason || !reason.trim()) return;
  try {
    const { error } = await supabase.rpc('admin_reject_event', { p_event_id: eventId, p_reason: reason.trim() });
    if (error) throw error;
    showToast('Event rejected and returned to organizer as draft.', 'success');
    loadedPanels.delete('approvals');
    loadedPanels.delete('dashboard');
    loadedPanels.delete('events-all');
    await loadApprovalQueue();
    await loadDashboardData();
  } catch (err) {
    showToast('Reject failed: ' + err.message, 'error');
  }
}

/* ── All Users (Phase 3 stub with real query) ── */

async function loadAllUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="6" class="ev-table-empty">No users found</td></tr>');
      return;
    }

    setSafeHTML(tbody, data.map((u, i) => {
      const joined = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const roleBadge = u.role === 'admin' ? 'admin-role' : u.role === 'organizer' ? 'organizer-role' : 'attendee-role';
      const roleLabel = u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : 'Attendee';
      return `<tr>
        <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
        <td style="font-weight:600;color:var(--ev-text)">${escapeHTML(u.full_name || '—')}</td>
        <td>${escapeHTML(u.email || '—')}</td>
        <td><span class="ev-badge ${roleBadge}">${roleLabel}</span></td>
        <td>${joined}</td>
        <td>
          ${u.role !== 'admin' ? `<button class="ev-btn ev-btn-outline ev-btn-sm" data-set-role="${u.id}" data-current="${u.role}" data-name="${escapeHTML(u.full_name || u.email || '')}">Change Role</button>` : '<span style="color:var(--ev-text-muted);font-size:.75rem">Protected</span>'}
        </td>
      </tr>`;
    }).join(''));

    // Wire role change buttons
    tbody.querySelectorAll('[data-set-role]').forEach(btn => {
      btn.addEventListener('click', () => handleRoleChange(btn.dataset.setRole, btn.dataset.current, btn.dataset.name));
    });
  } catch (err) {
    console.error('loadAllUsers error:', err);
    setSafeHTML(tbody, `<tr><td colspan="6" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

async function handleRoleChange(userId, currentRole, name) {
  const newRole = currentRole === 'attendee' ? 'organizer' : 'attendee';
  if (!confirm(`Change ${name}'s role from "${currentRole}" to "${newRole}"?`)) return;
  try {
    const { error } = await supabase.rpc('admin_set_user_role', { p_target_user_id: userId, p_new_role: newRole });
    if (error) throw error;
    showToast(`${name} is now ${newRole}`, 'success');
    loadedPanels.delete('users');
    loadedPanels.delete('dashboard');
    await loadAllUsers();
    await loadDashboardData();
  } catch (err) {
    showToast('Role change failed: ' + err.message, 'error');
  }
}

/* ── All Events (Phase 3 stub with real query) ── */

async function loadAllEvents() {
  const tbody = document.getElementById('all-events-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, status, admin_approved, date, category, organizer_id, profiles!events_organizer_id_fkey(full_name, email), ticket_tiers(capacity, sold_count, price)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No events in the system</td></tr>');
      return;
    }

    setSafeHTML(tbody, data.map((ev, i) => {
      const org = ev.profiles || {};
      const date = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const tiers = ev.ticket_tiers || [];
      const sold = tiers.reduce((s, t) => s + (t.sold_count || 0), 0);
      const cap = tiers.reduce((s, t) => s + (t.capacity || 0), 0);
      const rev = tiers.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0);

      let statusBadge, statusLabel;
      if (ev.status === 'published' && ev.admin_approved) {
        statusBadge = 'published'; statusLabel = 'Live';
      } else if (ev.status === 'published' && !ev.admin_approved) {
        statusBadge = 'pending'; statusLabel = 'Pending';
      } else if (ev.status === 'draft') {
        statusBadge = 'draft'; statusLabel = 'Draft';
      } else {
        statusBadge = 'draft'; statusLabel = ev.status || 'Unknown';
        statusLabel = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);
      }

      return `<tr>
        <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
        <td style="font-weight:600;color:var(--ev-text)">${escapeHTML(ev.title)}</td>
        <td>${escapeHTML(org.full_name || org.email || '—')}</td>
        <td>${date}</td>
        <td><span class="ev-badge ${statusBadge}">${statusLabel}</span></td>
        <td>${ev.admin_approved ? '<span style="color:var(--ev-success)">✓</span>' : '<span style="color:var(--ev-text-muted)">—</span>'}</td>
        <td>${sold}/${cap}</td>
        <td style="font-weight:600">${rev > 0 ? '$' + rev.toLocaleString() : '—'}</td>
      </tr>`;
    }).join(''));
  } catch (err) {
    console.error('loadAllEvents error:', err);
    setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

/* ── CMS Panel (Phase 3 stub) ── */

async function loadCMSPanel() {
  const body = document.getElementById('cms-body');
  if (!body) return;
  await renderCMSEditor(body);
}

/* ══════════════════════════════════════
   CMS SAVE/ERROR EVENTS
   ══════════════════════════════════════ */

function setupCMSEvents() {
  window.addEventListener('cms-saved', (e) => {
    showToast(`${e.detail.label} saved successfully!`, 'success');
  });
  window.addEventListener('cms-error', (e) => {
    showToast(`Save failed: ${e.detail.message}`, 'error');
  });
}

/* ══════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════ */

// escapeHTML is now imported from ../src/lib/utils.js (shared utility)
// Removed duplicate local definition to prevent shadowing and drift.

function animateStat(id, value, prefix = '') {
  const el = document.getElementById(id);
  if (!el) return;

  const target = Number(value) || 0;
  if (target === 0) { el.textContent = prefix + '0'; return; }

  const duration = 1200;
  const start = performance.now();

  (function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    const current = Math.floor(eased * target);
    el.textContent = prefix + current.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  })(start);
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `ev-toast ${type}`;

  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);

  if (container) {
    container.appendChild(toast);
  } else {
    document.body.appendChild(toast);
  }

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* Export for future sub-module use */
export { showToast, loadDashboardData };
