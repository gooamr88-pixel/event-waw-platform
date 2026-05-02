import { escapeHTML } from './utils.js';

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `ev-toast ${type}`;
  setSafeHTML(toast, `<span>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span> ${escapeHTML(message)}`);
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 300); }, 3500);
}

export function animateCounter(id, target) {
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

export function switchToPanel(panelName) {
  const items = document.querySelectorAll('.ev-nav-item');
  const panels = document.querySelectorAll('.ev-panel');
  items.forEach(i => i.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`[data-panel="${panelName}"]`);
  if (navItem) navItem.classList.add('active');
  const panel = document.getElementById('panel-' + panelName);
  if (panel) panel.classList.add('active');
}

export function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const overlay = document.getElementById('sidebar-overlay');

  document.querySelectorAll('.ev-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      switchToPanel(item.dataset.panel);
      sidebar?.classList.remove('open');
      overlay?.classList.remove('active');
    });
  });

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('active');
  });
  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('active');
  });

  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchToPanel(btn.dataset.goto));
  });

  document.getElementById('payout-btn')?.addEventListener('click', () => switchToPanel('financial'));
}

export function setupDarkMode() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = localStorage.getItem('ev-theme') === 'dark';
  if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
  btn.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('ev-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ev-theme', 'dark');
    }
  });
}

export function setupUserInfo({ user, profile }) {
  const name = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const email = user?.email || '';
  const userNameEl = document.getElementById('user-name');
  if (userNameEl) userNameEl.textContent = name;
  const userEmailEl = document.getElementById('user-email');
  if (userEmailEl) userEmailEl.textContent = email;
  const userAvatarEl = document.getElementById('user-avatar');
  if (userAvatarEl) userAvatarEl.textContent = name.charAt(0).toUpperCase();
  const welcomeEl = document.getElementById('welcome-name');
  if (welcomeEl) welcomeEl.textContent = name.split(' ')[0];
}
