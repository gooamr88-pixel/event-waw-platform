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
import { protectPage, performSignOut, isAdminLevel } from '../src/lib/guard.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { escapeHTML } from '../src/lib/utils.js';
import { showConfirmModal, showPromptModal } from '../src/lib/ui-modals.js';

let currentPanel = 'dashboard';

/* ── Role Hierarchy ──
   super_admin (level 3): Full access — all panels, CMS, maintenance, roles, block
   admin       (level 2): Approvals, Users (role change up to moderator), Events, Block
   moderator   (level 1): View stats, Approvals (approve/reject only), View events
*/
let adminRole = 'moderator';  // default to lowest; set after auth
function getAdminLevel(role) {
  if (role === 'super_admin') return 3;
  if (role === 'admin') return 2;
  if (role === 'moderator') return 1;
  return 0;
}
function canAccess(minRole) {
  return getAdminLevel(adminRole) >= getAdminLevel(minRole);
}

/* ══════════════════════════════════════
   INIT
   ══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // ── Strict admin gate ──
    const auth = await protectPage({ requireRole: 'admin' });
    if (!auth) return;

    // ── Determine admin level ──
    adminRole = auth.profile?.role || 'moderator';

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
    enforceRolePermissions();

    // ── Load initial data ──
    await loadDashboardData();
  } catch (err) {
    console.error("FATAL ADMIN INIT ERROR:", err);
    alert("Dashboard Initialization Error: " + err.message + "\nLine: " + err.stack);
  }
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
  const { user, profile } = auth;
  const name = profile?.full_name || user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : null) || 'Admin';
  const email = profile?.email || user?.email || 'admin@eventwaw.com';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('user-avatar');
  const welcomeEl = document.getElementById('welcome-name');
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = initials;
  if (welcomeEl) welcomeEl.textContent = name.split(' ')[0];

  // Show role badge in sidebar
  const roleMap = { super_admin: 'Super Admin', admin: 'Admin', moderator: 'Moderator' };
  const sidebarSub = document.querySelector('.ev-sidebar-brand p');
  if (sidebarSub) sidebarSub.textContent = roleMap[adminRole] || 'Admin Console';

  // Update header badge
  const envBadge = document.querySelector('.admin-env-badge');
  if (envBadge) {
    envBadge.textContent = (roleMap[adminRole] || 'ADMIN').toUpperCase();
    if (adminRole === 'super_admin') envBadge.style.background = '#7c3aed';
    else if (adminRole === 'moderator') envBadge.style.background = '#0891b2';
  }
}

/* ══════════════════════════════════════
   ROLE-BASED ACCESS CONTROL (RBAC)
   ══════════════════════════════════════ */

function enforceRolePermissions() {
  // Panel access rules:
  // super_admin → all panels
  // admin → dashboard, approvals, users, events-all (NO cms)
  // moderator → dashboard, approvals, events-all (NO users, NO cms)

  const panelRules = {
    'users': 'admin',      // admin+ can manage users
    'cms': 'super_admin',  // only super_admin can access CMS & maintenance
  };

  // Hide sidebar nav items the role can't access
  document.querySelectorAll('.ev-nav-item[data-panel]').forEach(item => {
    const panel = item.dataset.panel;
    const minRole = panelRules[panel];
    if (minRole && !canAccess(minRole)) {
      item.style.display = 'none';
    }
  });

  // Hide header shortcut links the role can't access
  document.querySelectorAll('.ev-header-link[data-panel]').forEach(item => {
    const panel = item.dataset.panel;
    const minRole = panelRules[panel];
    if (minRole && !canAccess(minRole)) {
      item.style.display = 'none';
    }
  });

  // Hide maintenance toggle for non-super_admin
  const mmToggle = document.getElementById('admin-maintenance-toggle');
  if (mmToggle && !canAccess('super_admin')) {
    const toggleWrap = mmToggle.closest('div[style*="display:flex"]');
    if (toggleWrap && toggleWrap.querySelector('.ev-toggle')) {
      toggleWrap.style.display = 'none';
    }
  }
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
    const confirmed = await showConfirmModal({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out of the Admin Console?',
      confirmText: 'Sign Out',
      confirmColor: '#dc2626'
    });
    if (confirmed) {
      await performSignOut('/login.html');
    }
  });
  // Dropdown sign-out button
  document.getElementById('dropdown-signout')?.addEventListener('click', async () => {
    const confirmed = await showConfirmModal({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out of the Admin Console?',
      confirmText: 'Sign Out',
      confirmColor: '#dc2626'
    });
    if (confirmed) {
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
    const ctx = document.getElementById('admin-revenue-chart');
    if (ctx && !window.adminChartInstance) {
      window.adminChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          datasets: [
            {
              label: 'Ticket Sales',
              data: [120, 190, 300, 250, 400, 450, 500],
              borderColor: '#2563eb',
              backgroundColor: 'rgba(37, 99, 235, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.4
            },
            {
              label: 'Platform Revenue ($)',
              data: [300, 450, 700, 600, 1000, 1200, 1500],
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' }
          },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
    } else if (window.adminChartInstance) {
      // If we re-fetch, we could theoretically update chart data here.
      window.adminChartInstance.update();
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
  const confirmed = await showConfirmModal({
    title: 'Approve Event',
    message: 'Approve this event for public listing?',
    confirmText: 'Approve Event',
    confirmColor: '#16a34a'
  });
  if (!confirmed) return;
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
  const reason = await showPromptModal({
    title: 'Reject Event',
    message: `Reject "${title}"? Please provide a reason:`,
    placeholder: 'Reason for rejection...',
    confirmText: 'Reject Event',
    confirmColor: '#dc2626'
  });
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
      .select('id, full_name, email, role, is_blocked, blocked_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="6" class="ev-table-empty">No users found</td></tr>');
      return;
    }

    const exportBtn = document.getElementById('export-users-btn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const rows = [['ID', 'Name', 'Email', 'Role', 'Blocked', 'Joined Date']];
        data.forEach(u => rows.push([
          u.id, 
          u.full_name || '', 
          u.email || '', 
          u.role || 'attendee',
          u.is_blocked ? 'Yes' : 'No',
          new Date(u.created_at).toLocaleDateString()
        ]));
        downloadCSV(rows, `users_${Date.now()}.csv`);
      };
    }

    setSafeHTML(tbody, data.map((u, i) => {
      const joined = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const roleStyleMap = {
        super_admin: { badge: 'admin-role', label: 'Super Admin', extra: 'background:rgba(124,58,237,.12);color:#7c3aed' },
        admin: { badge: 'admin-role', label: 'Admin', extra: '' },
        moderator: { badge: 'organizer-role', label: 'Moderator', extra: 'background:rgba(8,145,178,.12);color:#0891b2' },
        organizer: { badge: 'organizer-role', label: 'Organizer', extra: '' },
        attendee: { badge: 'attendee-role', label: 'Attendee', extra: '' },
      };
      const rs = roleStyleMap[u.role] || roleStyleMap.attendee;
      const isBlocked = u.is_blocked === true;
      const blockedBadge = isBlocked ? ' <span class="ev-badge" style="background:rgba(220,38,38,.1);color:#dc2626;font-size:.65rem;margin-left:4px">BLOCKED</span>' : '';
      const targetLevel = getAdminLevel(u.role);
      const myLevel = getAdminLevel(adminRole);
      const canManage = myLevel > targetLevel;
      return `<tr${isBlocked ? ' style="opacity:.6"' : ''}>
        <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
        <td style="font-weight:600;color:var(--ev-text)">${escapeHTML(u.full_name || '—')}${blockedBadge}</td>
        <td>${escapeHTML(u.email || '—')}</td>
        <td><span class="ev-badge ${rs.badge}"${rs.extra ? ` style="${rs.extra}"` : ''}>${rs.label}</span></td>
        <td>${joined}</td>
        <td>
          ${canManage ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="ev-btn ev-btn-outline ev-btn-sm" data-set-role="${u.id}" data-current="${u.role}" data-name="${escapeHTML(u.full_name || u.email || '')}">Change Role</button>
            ${isBlocked 
              ? `<button class="ev-btn ev-btn-sm" style="background:#10b981;color:#fff;border:none" data-unblock="${u.id}" data-name="${escapeHTML(u.full_name || u.email || '')}">Unblock</button>` 
              : `<button class="ev-btn ev-btn-sm" style="background:#dc2626;color:#fff;border:none" data-block="${u.id}" data-name="${escapeHTML(u.full_name || u.email || '')}">Block</button>`
            }
          </div>` : '<span style="color:var(--ev-text-muted);font-size:.75rem">\u2014</span>'}
        </td>
      </tr>`;
    }).join(''));

    // Wire role change buttons
    tbody.querySelectorAll('[data-set-role]').forEach(btn => {
      btn.addEventListener('click', () => handleRoleChange(btn.dataset.setRole, btn.dataset.current, btn.dataset.name));
    });

    // Wire block buttons
    tbody.querySelectorAll('[data-block]').forEach(btn => {
      btn.addEventListener('click', () => handleBlockUser(btn.dataset.block, btn.dataset.name));
    });

    // Wire unblock buttons
    tbody.querySelectorAll('[data-unblock]').forEach(btn => {
      btn.addEventListener('click', () => handleUnblockUser(btn.dataset.unblock, btn.dataset.name));
    });
  } catch (err) {
    console.error('loadAllUsers error:', err);
    setSafeHTML(tbody, `<tr><td colspan="6" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

function handleRoleChange(userId, currentRole, name) {
  // Remove existing modal if any
  const existing = document.getElementById('admin-role-modal');
  if (existing) existing.remove();

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'ev-modal-overlay active';
  overlay.id = 'admin-role-modal';
  overlay.style.zIndex = '999999'; // ensure it's on top

  const modalHTML = `
    <div class="ev-modal" style="max-width: 400px;">
      <div class="ev-modal-header">
        <h2>Change Role</h2>
        <button class="ev-modal-close" id="role-modal-close">✕</button>
      </div>
      <p style="font-size: .9rem; color: var(--ev-text-muted); margin-bottom: 20px;">
        Select a new role for <strong>${escapeHTML(name)}</strong>.
      </p>
      <div class="ev-form-group">
        <label class="ev-form-label">User Role</label>
        <select id="role-modal-select" class="ev-form-input">
          <option value="attendee" ${currentRole === 'attendee' ? 'selected' : ''}>Attendee</option>
          <option value="organizer" ${currentRole === 'organizer' ? 'selected' : ''}>Organizer</option>
          ${canAccess('admin') ? `<option value="moderator" ${currentRole === 'moderator' ? 'selected' : ''}>Moderator</option>` : ''}
          ${canAccess('super_admin') ? `<option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>Admin</option>` : ''}
          ${canAccess('super_admin') ? `<option value="super_admin" ${currentRole === 'super_admin' ? 'selected' : ''}>Super Admin</option>` : ''}
        </select>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:24px;">
        <button class="ev-btn ev-btn-outline" id="role-modal-cancel">Cancel</button>
        <button class="ev-btn" id="role-modal-save">Save Changes</button>
      </div>
    </div>
  `;
  
  setSafeHTML(overlay, modalHTML);
  document.body.appendChild(overlay);

  const closeBtn = document.getElementById('role-modal-close');
  const cancelBtn = document.getElementById('role-modal-cancel');
  const saveBtn = document.getElementById('role-modal-save');
  const selectEl = document.getElementById('role-modal-select');

  const closeModal = () => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  saveBtn.addEventListener('click', async () => {
    const newRole = selectEl.value;
    if (newRole === currentRole) {
      closeModal();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="ev-spinner" style="width:16px;height:16px;border-width:2px;display:inline-block"></span>';

    try {
      const { error } = await supabase.rpc('admin_set_user_role', { p_target_user_id: userId, p_new_role: newRole });
      if (error) throw error;
      showToast(`${name} is now ${newRole}`, 'success');
      loadedPanels.delete('users');
      loadedPanels.delete('dashboard');
      closeModal();
      await loadAllUsers();
      await loadDashboardData();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
      showToast('Role change failed: ' + err.message, 'error');
    }
  });
}

/* ── All Events (Phase 3 stub with real query) ── */

async function loadAllEvents() {
  const tbody = document.getElementById('all-events-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, description, cover_image, status, admin_approved, admin_rejected_reason, date, end_date, category, venue, venue_address, city, country, lat, lng, organizer_id, created_at, profiles!events_organizer_id_fkey(full_name, email, phone, avatar_url), ticket_tiers(id, name, price, capacity, sold_count)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No events in the system</td></tr>');
      return;
    }

    const exportBtn = document.getElementById('export-events-btn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const rows = [['Title', 'Organizer Email', 'Date', 'Status', 'Approved', 'Tickets Sold', 'Capacity', 'Revenue']];
        data.forEach(ev => {
          const org = ev.profiles || {};
          const tiers = ev.ticket_tiers || [];
          const sold = tiers.reduce((s, t) => s + (t.sold_count || 0), 0);
          const cap = tiers.reduce((s, t) => s + (t.capacity || 0), 0);
          const rev = tiers.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0);
          rows.push([
            ev.title || '',
            org.email || '',
            ev.date ? new Date(ev.date).toLocaleDateString() : '',
            ev.status || '',
            ev.admin_approved ? 'Yes' : 'No',
            sold, cap, rev
          ]);
        });
        downloadCSV(rows, `events_${Date.now()}.csv`);
      };
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
        <td><a href="#" class="ev-event-detail-link" data-event-idx="${i}" style="font-weight:600;color:var(--ev-accent);text-decoration:none;cursor:pointer">${escapeHTML(ev.title)}</a></td>
        <td>${escapeHTML(org.full_name || org.email || '—')}</td>
        <td>${date}</td>
        <td><span class="ev-badge ${statusBadge}">${statusLabel}</span></td>
        <td>${ev.admin_approved ? '<span style="color:var(--ev-success)">✓</span>' : '<span style="color:var(--ev-text-muted)">—</span>'}</td>
        <td>${sold}/${cap}</td>
        <td style="font-weight:600">${rev > 0 ? '$' + rev.toLocaleString() : '—'}</td>
        <td>
          <button class="ev-btn ev-btn-outline ev-btn-sm ev-admin-suspend-btn" style="color:var(--ev-danger);border-color:var(--ev-danger)" data-id="${ev.id}" data-title="${escapeHTML(ev.title)}" ${statusBadge === 'draft' ? 'disabled' : ''}>Suspend</button>
        </td>
      </tr>`;
    }).join(''));

    // Wire up suspend buttons
    tbody.querySelectorAll('.ev-admin-suspend-btn').forEach(btn => {
      btn.addEventListener('click', () => handleAdminSuspendEvent(btn.dataset.id, btn.dataset.title));
    });

    // Wire up event detail links
    tbody.querySelectorAll('.ev-event-detail-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(link.dataset.eventIdx, 10);
        if (data[idx]) showEventDetailModal(data[idx]);
      });
    });
  } catch (err) {
    console.error('loadAllEvents error:', err);
    setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

/* ── Event Detail Modal ── */

function showEventDetailModal(ev) {
  const existing = document.querySelector('.ev-event-detail-overlay');
  if (existing) existing.remove();

  const org = ev.profiles || {};
  const tiers = ev.ticket_tiers || [];
  const totalSold = tiers.reduce((s, t) => s + (t.sold_count || 0), 0);
  const totalCap = tiers.reduce((s, t) => s + (t.capacity || 0), 0);
  const totalRev = tiers.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0);

  const eventDate = ev.date ? new Date(ev.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const endDate = ev.end_date ? new Date(ev.end_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const createdDate = ev.created_at ? new Date(ev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const catLabel = ev.category ? ev.category.charAt(0).toUpperCase() + ev.category.slice(1) : '—';

  let statusHTML;
  if (ev.status === 'published' && ev.admin_approved) {
    statusHTML = '<span class="ev-badge published">Live</span>';
  } else if (ev.status === 'published' && !ev.admin_approved) {
    statusHTML = '<span class="ev-badge pending">Pending Approval</span>';
  } else {
    statusHTML = `<span class="ev-badge draft">${ev.status || 'Draft'}</span>`;
  }

  const rejectedHTML = ev.admin_rejected_reason
    ? `<div style="background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.12);border-radius:10px;padding:12px 16px;margin-top:12px">
         <strong style="color:#dc2626;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Rejection Reason</strong>
         <span style="font-size:.9rem">${escapeHTML(ev.admin_rejected_reason)}</span>
       </div>` : '';

  const coverHTML = ev.cover_image
    ? `<div style="border-radius:12px;overflow:hidden;margin-bottom:20px;max-height:220px">
         <img src="${escapeHTML(ev.cover_image)}" alt="Cover" style="width:100%;height:220px;object-fit:cover;display:block" onerror="this.style.display='none'" />
       </div>` : '';

  const tiersHTML = tiers.length > 0
    ? `<div style="margin-top:16px">
         <h4 style="font-size:.85rem;font-weight:700;margin-bottom:8px;color:var(--ev-text)">🎫 Ticket Tiers</h4>
         <table style="width:100%;border-collapse:collapse;font-size:.82rem">
           <thead><tr style="border-bottom:1px solid var(--ev-border)">
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Tier</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Price</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Sold</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Capacity</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Revenue</th>
           </tr></thead>
           <tbody>${tiers.map(t => `<tr style="border-bottom:1px solid var(--ev-border)">
             <td style="padding:6px 8px;font-weight:600">${escapeHTML(t.name || '—')}</td>
             <td style="padding:6px 8px">${t.price > 0 ? '$' + Number(t.price).toLocaleString() : 'Free'}</td>
             <td style="padding:6px 8px">${t.sold_count || 0}</td>
             <td style="padding:6px 8px">${t.capacity || 0}</td>
             <td style="padding:6px 8px;font-weight:600">${t.price > 0 ? '$' + ((t.sold_count || 0) * t.price).toLocaleString() : '—'}</td>
           </tr>`).join('')}</tbody>
         </table>
       </div>` : '<p style="color:var(--ev-text-muted);font-size:.85rem;margin-top:12px">No ticket tiers configured.</p>';

  const locationParts = [ev.venue, ev.venue_address, ev.city, ev.country].filter(Boolean);
  const locationHTML = locationParts.length > 0
    ? `<div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:8px">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-top:2px;flex-shrink:0;color:var(--ev-text-muted)"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
         <span style="font-size:.88rem">${escapeHTML(locationParts.join(', '))}</span>
       </div>` : '';

  const overlay = document.createElement('div');
  overlay.className = 'ev-modal-overlay active ev-event-detail-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  setSafeHTML(overlay, `
    <div class="ev-modal" style="max-width:640px;max-height:85vh;overflow-y:auto">
      <div class="ev-modal-header" style="position:sticky;top:0;z-index:2;background:var(--ev-bg)">
        <h2 style="font-size:1.1rem">Event Details</h2>
        <button class="ev-modal-close" id="event-detail-close">✕</button>
      </div>

      ${coverHTML}

      <div style="padding:0 0 4px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px">
          <h3 style="font-size:1.15rem;font-weight:800;margin:0;color:var(--ev-text)">${escapeHTML(ev.title)}</h3>
          ${statusHTML}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;font-size:.85rem;color:var(--ev-text-muted)">
          <span>📅 ${eventDate}</span>
          ${endDate ? `<span>→ ${endDate}</span>` : ''}
          <span>🏷 ${catLabel}</span>
          <span>📝 Created ${createdDate}</span>
        </div>

        ${locationHTML}

        ${ev.description ? `<div style="margin:16px 0;padding:14px;background:var(--ev-bg-secondary);border-radius:10px;font-size:.9rem;line-height:1.7;color:var(--ev-text);max-height:150px;overflow-y:auto">${escapeHTML(ev.description)}</div>` : ''}

        ${rejectedHTML}

        <!-- Organizer Info -->
        <div style="margin-top:16px;padding:14px;background:var(--ev-bg-secondary);border-radius:10px;display:flex;align-items:center;gap:14px">
          <div style="width:42px;height:42px;border-radius:50%;background:var(--ev-accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;flex-shrink:0">${escapeHTML((org.full_name || 'O').charAt(0).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.9rem;color:var(--ev-text)">${escapeHTML(org.full_name || '—')}</div>
            <div style="font-size:.8rem;color:var(--ev-text-muted)">${escapeHTML(org.email || '—')}${org.phone ? ' · ' + escapeHTML(org.phone) : ''}</div>
          </div>
          <span style="font-size:.7rem;background:var(--ev-bg);padding:4px 10px;border-radius:20px;font-weight:600;color:var(--ev-text-muted)">Organizer</span>
        </div>

        <!-- Stats Summary -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px">
          <div style="text-align:center;padding:14px;background:var(--ev-bg-secondary);border-radius:10px">
            <div style="font-size:1.3rem;font-weight:800;color:var(--ev-accent)">${totalSold}</div>
            <div style="font-size:.75rem;color:var(--ev-text-muted)">Tickets Sold</div>
          </div>
          <div style="text-align:center;padding:14px;background:var(--ev-bg-secondary);border-radius:10px">
            <div style="font-size:1.3rem;font-weight:800;color:var(--ev-text)">${totalCap}</div>
            <div style="font-size:.75rem;color:var(--ev-text-muted)">Capacity</div>
          </div>
          <div style="text-align:center;padding:14px;background:var(--ev-bg-secondary);border-radius:10px">
            <div style="font-size:1.3rem;font-weight:800;color:#10b981">${totalRev > 0 ? '$' + totalRev.toLocaleString() : 'Free'}</div>
            <div style="font-size:.75rem;color:var(--ev-text-muted)">Revenue</div>
          </div>
        </div>

        ${tiersHTML}

        <div style="font-size:.75rem;color:var(--ev-text-muted);margin-top:16px;text-align:right">Event ID: ${ev.id}</div>
      </div>
    </div>
  `);

  document.body.appendChild(overlay);

  const closeModal = () => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  document.getElementById('event-detail-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}

/* ── CMS Panel (Phase 3 stub) ── */

async function loadCMSPanel() {
  const body = document.getElementById('cms-body');
  const mmToggle = document.getElementById('admin-maintenance-toggle');
  
  if (mmToggle && !mmToggle.dataset.initialized) {
    mmToggle.dataset.initialized = 'true';
    try {
      const { data } = await supabase.from('platform_settings').select('value').eq('key', 'maintenance_mode').single();
      if (data) mmToggle.checked = (data.value === true || data.value === 'true');
    } catch (e) { console.warn('Could not load maintenance mode state'); }

    mmToggle.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked;
      try {
        const { error } = await supabase.from('platform_settings').upsert({ key: 'maintenance_mode', value: isEnabled });
        if (error) throw error;
        showToast(isEnabled ? 'Maintenance Mode ENABLED. Platform is offline.' : 'Maintenance Mode DISABLED. Platform is live.', isEnabled ? 'error' : 'success');
      } catch (err) {
        e.target.checked = !isEnabled; // revert
        showToast('Failed to update maintenance mode: ' + err.message, 'error');
      }
    });
  }

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
   UTILITIES & ACTIONS
   ══════════════════════════════════════ */

function setupTableSearch(inputId, tbodyId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const rows = document.querySelectorAll(`#${tbodyId} tr`);
    rows.forEach(row => {
      if (row.querySelector('.ev-table-empty')) return;
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
  });
}

function downloadCSV(rowsArray, filename) {
  const csv = rowsArray.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('CSV downloaded successfully!', 'success');
}

// Call these once after DOM load
setTimeout(() => {
  setupTableSearch('search-approvals', 'approvals-tbody');
  setupTableSearch('search-users', 'users-tbody');
  setupTableSearch('search-all-events', 'all-events-tbody');
}, 500);

async function handleAdminSuspendEvent(eventId, title) {
  const reason = await showPromptModal({
    title: 'Suspend Event',
    message: `Suspend "${title}"? This will hide it from the public. Provide a reason:`,
    placeholder: 'Reason for suspension...',
    confirmText: 'Suspend Event',
    confirmColor: '#dc2626'
  });
  if (!reason || !reason.trim()) return;
  try {
    const { error } = await supabase.rpc('admin_reject_event', { p_event_id: eventId, p_reason: reason.trim() });
    if (error) throw error;
    showToast(`Event "${title}" has been suspended.`, 'success');
    loadedPanels.delete('events-all');
    loadedPanels.delete('dashboard');
    loadedPanels.delete('approvals');
    await loadAllEvents();
    await loadDashboardData();
  } catch (err) {
    showToast('Failed to suspend event: ' + err.message, 'error');
  }
}

/* ── Block / Unblock User ── */

async function handleBlockUser(userId, name) {
  const reason = await showPromptModal({
    title: '🚫 Block User',
    message: `Block <strong>${escapeHTML(name)}</strong> from the entire platform? They will be immediately signed out and unable to log in.\n\nProvide a reason:`,
    placeholder: 'Reason for blocking (e.g. Terms of Service violation)...',
    confirmText: 'Block User',
    confirmColor: '#dc2626'
  });
  if (!reason || !reason.trim()) return;

  try {
    const { error } = await supabase.rpc('admin_block_user', { p_target_user_id: userId, p_reason: reason.trim() });
    if (error) throw error;
    showToast(`${name} has been blocked from the platform.`, 'success');
    loadedPanels.delete('users');
    loadedPanels.delete('dashboard');
    await loadAllUsers();
    await loadDashboardData();
  } catch (err) {
    showToast('Block failed: ' + err.message, 'error');
  }
}

async function handleUnblockUser(userId, name) {
  const confirmed = await showConfirmModal({
    title: '✅ Unblock User',
    message: `Unblock <strong>${escapeHTML(name)}</strong>? They will be able to log in and use the platform again.`,
    confirmText: 'Unblock User',
    confirmColor: '#10b981'
  });
  if (!confirmed) return;

  try {
    const { error } = await supabase.rpc('admin_unblock_user', { p_target_user_id: userId });
    if (error) throw error;
    showToast(`${name} has been unblocked.`, 'success');
    loadedPanels.delete('users');
    loadedPanels.delete('dashboard');
    await loadAllUsers();
    await loadDashboardData();
  } catch (err) {
    showToast('Unblock failed: ' + err.message, 'error');
  }
}

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
