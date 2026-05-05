import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';

/* ── H-1 Race-condition guard state ── */
let _activePanel = 'events';
let _switchId   = 0;   // monotonic counter — increments on every switchToPanel

/** Return the name of the currently-active panel. */
export function getActivePanel() { return _activePanel; }

/**
 * Return the current switch-id.
 * Panel data-loaders should capture this value BEFORE their first await,
 * then compare after each await. If it changed, another tab was clicked
 * and the response is stale — bail out.
 */
export function getSwitchId() { return _switchId; }

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `ev-toast ${type}`;
  setSafeHTML(toast, `<span>${type === 'success' ? '[OK]' : type === 'error' ? '[X]' : '[i]'}</span> ${escapeHTML(message)}`);
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 300); }, 3500);
}

const _intervals = {};

export function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;

  // ── H-2: Clear any in-flight animation on this element ──
  const prevId = el.dataset.intervalId;
  if (prevId) { clearInterval(Number(prevId)); delete el.dataset.intervalId; }
  if (_intervals[id]) { clearInterval(_intervals[id]); delete _intervals[id]; }

  const numTarget = Math.round(Number(target) || 0);
  if (numTarget === 0) { el.textContent = '0'; return; }

  let current = 0;
  const step = Math.max(1, Math.ceil(numTarget / 20));
  const intervalId = setInterval(() => {
    current += step;
    if (current >= numTarget) {
      current = numTarget;
      clearInterval(intervalId);
      delete _intervals[id];
      delete el.dataset.intervalId;
    }
    el.textContent = current.toLocaleString();
  }, 40);

  // Store on BOTH the map and the DOM element for double-safety
  _intervals[id] = intervalId;
  el.dataset.intervalId = String(intervalId);
}

export function switchToPanel(panelName) {
  // ── H-1: update race-condition guards ──
  _activePanel = panelName;
  _switchId++;

  const items = document.querySelectorAll('.ev-nav-item');
  const panels = document.querySelectorAll('.ev-panel');
  items.forEach(i => i.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`[data-panel="${panelName}"]`);
  if (navItem) navItem.classList.add('active');
  const panel = document.getElementById('panel-' + panelName);
  if (panel) panel.classList.add('active');

  // ── Lazy-load archives when panel is opened ──
  if (panelName === 'archives') {
    import('./dashboard-events.js').then(async (mod) => {
      const archived = await mod.loadArchivedEvents();
      mod.renderArchivesTable(archived);
    }).catch(err => console.warn('Failed to load archives:', err));
  }
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

// NOTE: setupDarkMode is in dashboard-payout.js (uses #dark-mode-toggle)

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

/* ══════════════════════════════════════
   H-3  Global Keyboard Manager
   Close dropdowns on Escape, toggle
   aria-expanded for a11y compliance.
   ══════════════════════════════════════ */
export function setupGlobalKeyboardManager() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    let handled = false;

    // ── Close notification dropdown ──
    const notifDropdown = document.getElementById('notif-dropdown');
    const notifBell     = document.getElementById('notif-bell');
    if (notifDropdown?.classList.contains('open')) {
      notifDropdown.classList.remove('open');
      notifBell?.setAttribute('aria-expanded', 'false');
      handled = true;
    }

    // ── Close user dropdown ──
    const userWrap     = document.getElementById('user-wrap');
    const userDropdown = document.getElementById('user-dropdown');
    if (userWrap?.classList.contains('open')) {
      userWrap.classList.remove('open');
      userWrap.querySelector('#user-info')?.setAttribute('aria-expanded', 'false');
      handled = true;
    }

    // ── Close any open modal overlays (topmost first) ──
    if (!handled) {
      const openModals = document.querySelectorAll('.ev-modal-overlay.active');
      if (openModals.length) {
        openModals[openModals.length - 1].remove();
        handled = true;
      }
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}
