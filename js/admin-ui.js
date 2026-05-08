/* ===================================
   EVENTSLI — Admin UI Helpers
   =================================== */

import { performSignOut } from '../src/lib/guard.js';
import { showConfirmModal } from '../src/lib/ui-modals.js';

/**
 * Applies the saved theme or system preference.
 */
export function applyTheme() {
  const saved = localStorage.getItem('theme');
  const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = isDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
}

/**
 * Sets up the dark mode toggle button.
 */
export function setupDarkMode() {
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

/**
 * Updates the UI with logged-in user information.
 */
export function setupUserInfo(auth, adminRole) {
  const { user, profile } = auth;
  const name = profile?.full_name || user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : null) || 'Admin';
  const email = profile?.email || user?.email || 'admin@eventsli.com';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('user-avatar');
  const welcomeEl = document.getElementById('welcome-name');
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = initials;
  if (welcomeEl) welcomeEl.textContent = name.split(' ')[0];

  const roleMap = { super_admin: 'Super Admin', admin: 'Admin', moderator: 'Moderator' };
  const sidebarSub = document.querySelector('.ev-sidebar-brand p');
  if (sidebarSub) sidebarSub.textContent = roleMap[adminRole] || 'Admin Console';

  const envBadge = document.querySelector('.admin-env-badge');
  if (envBadge) {
    envBadge.textContent = (roleMap[adminRole] || 'ADMIN').toUpperCase();
    if (adminRole === 'super_admin') envBadge.style.background = '#7c3aed';
    else if (adminRole === 'moderator') envBadge.style.background = '#0891b2';
  }
}

/**
 * Sets up the live clock in the header.
 */
export function setupClock() {
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

/**
 * Animates a numeric stat value.
 */
export function animateStat(id, value, prefix = '') {
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

/**
 * Shows a temporary toast message.
 */
export function showToast(message, type = 'success') {
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

/**
 * Triggers a CSV file download.
 */
export function downloadCSV(rowsArray, filename) {
  const csv = rowsArray.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('CSV downloaded successfully!', 'success');
}

/**
 * Sets up filtering for a table.
 */
export function setupTableSearch(inputId, tbodyId) {
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
