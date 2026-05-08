/* ===================================
   EVENTSLI — Admin Navigation
   =================================== */

/**
 * Sets up sidebar panel switching.
 */
export function setupNavigation(onPanelSwitch) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.addEventListener('click', (e) => {
    const item = e.target.closest('.ev-nav-item[data-panel]');
    if (!item) return;

    const panelId = item.dataset.panel;
    onPanelSwitch(panelId);
  });
}

/**
 * Switches the active panel and nav item.
 */
export function switchPanel(panelId) {
  document.querySelector('.ev-nav-item.active')?.classList.remove('active');
  document.querySelector('.ev-panel.active')?.classList.remove('active');

  const navItem = document.querySelector(`.ev-nav-item[data-panel="${panelId}"]`);
  const panel = document.getElementById(`panel-${panelId}`);
  if (navItem) navItem.classList.add('active');
  if (panel) panel.classList.add('active');

  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
}

/**
 * Sets up header shortcut links.
 */
export function setupHeaderShortcuts(onPanelSwitch) {
  document.querySelectorAll('.ev-header-link[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      onPanelSwitch(panelId);
    });
  });
}

/**
 * Sets up the user profile dropdown.
 */
export function setupUserDropdown() {
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

/**
 * Sets up mobile sidebar toggle.
 */
export function setupMobileToggle() {
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

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;
    if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
      sidebar.classList.remove('open');
      overlay?.classList.remove('active');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      overlay?.classList.remove('active');
    }
  });
}

import { performSignOut } from '../src/lib/guard.js';
import { showConfirmModal } from '../src/lib/ui-modals.js';

/**
 * Sets up the sign-out buttons.
 */
export function setupSignOut() {
  const handler = async () => {
    const confirmed = await showConfirmModal({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out of the Admin Console?',
      confirmText: 'Sign Out',
      confirmColor: '#dc2626'
    });
    if (confirmed) {
      await performSignOut('/login.html');
    }
  };

  document.getElementById('signout-btn')?.addEventListener('click', handler);
  document.getElementById('dropdown-signout')?.addEventListener('click', handler);
}
