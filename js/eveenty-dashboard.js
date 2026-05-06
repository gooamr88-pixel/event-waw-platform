/* ===================================
   EVENT WAW DASHBOARD - Controller
   Single-file, modular, production-ready
   =================================== */

import { resetCreateEventForm, initGooglePlacesAutocomplete, renderGoogleKeywords, showGoogleMapPreview, setupCeUpload, handleCeFileUpload, renderCeTicketsTable, updateCePreview, showEditModal, uploadCoverImage, uploadEventFile } from '../src/lib/dashboard-modals.js';
import { setupCreateModal, loadEventForEditing } from '../src/lib/dashboard-modals.js';
import { setupSearch } from '../src/lib/dashboard-search.js';
import { renderCalendar, setupCalendar, setCalendarEvents } from '../src/lib/dashboard-calendar.js';
import { setupEmailAttendees } from '../src/lib/dashboard-attendees.js';
import { setupProfilePanel, setupUserDropdown } from '../src/lib/dashboard-profile.js';
import { renderRevenueBreakdown, initCharts } from '../src/lib/dashboard-analytics.js';
import { setupPromoPanel, setupApprovalPanel } from '../src/lib/dashboard-vendors.js';
import { loadPromoCodes, setupFinancialPanel, setupPromoForm } from '../src/lib/dashboard-promos.js';
import { loadPayoutData, setupDarkMode, setupPayoutPanel } from '../src/lib/dashboard-payout.js';
import { loadNotifications, renderNotifications, timeAgo } from '../src/lib/dashboard-notifications.js';
import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { getOrganizerEvents, createEvent, deleteEvent, updateEvent } from '../src/lib/events.js';
import { protectPage, performSignOut } from '../src/lib/guard.js';
import { escapeHTML, formatCurrency } from '../src/lib/utils.js';
import { showToast, animateCounter, setupSidebar, setupUserInfo, setupGlobalKeyboardManager, getSwitchId } from '../src/lib/dashboard-ui.js';
import { renderEventsTable, populateEventSelects, showTableSkeleton } from '../src/lib/dashboard-events.js';
import { setupTicketsPanel } from '../src/lib/dashboard-tickets.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { onDashboardAction } from '../src/lib/dashboard-bus.js';

// H-5: Guard to prevent duplicate listener attachment on setupTicketsPanel
let _ticketsPanelInitialized = false;

/* ==================================
   INIT
   ================================== */
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await protectPage({ requireRole: 'organizer' });
  if (!auth) return;

  setupUserInfo(auth);
  setupSidebar();
  injectAdminBridge(auth);
  setupCreateModal();
  setupSearch();
  setupSignOut();
  setupApprovalPanel();
  setupPromoPanel();
  setupFinancialPanel();
  setupPayoutPanel();
  setupDarkMode();
  setupNotifications();
  setupCalendar();
  setupEmailAttendees();
  setupUserDropdown();
  setupProfilePanel();
  setupPromoForm();
  loadPromoCodes();            // Initial load for promos
  setupUserDropdownToggle();   // H-3: click-toggle + aria-expanded
  setupGlobalKeyboardManager(); // H-3: Escape key handler

  // Register actions on the event bus (replaces window.* globals)
  onDashboardAction('refreshDashboard', loadDashboard);
  onDashboardAction('editEvent', loadEventForEditing);

  await loadDashboard();
});

/* ==================================
   SIGN OUT
   ================================== */
function setupSignOut() {
  document.getElementById('signout-btn')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to sign out?')) {
      await performSignOut('/login.html');
    }
  });
}

/* ==================================
   LOAD DASHBOARD DATA
   ================================== */
export async function loadDashboard() {
  // ── H-1: capture switch-id to detect stale responses ──
  const mySwitch = getSwitchId();

  try {
    // ── Show skeleton while loading ──
    showTableSkeleton('events-tbody', 5, 8);

    const user = await getCurrentUser();
    if (getSwitchId() !== mySwitch) return; // stale
    const events = await getOrganizerEvents();
    if (getSwitchId() !== mySwitch) return; // stale

    // Stats
    const total = events.length;
    const live = events.filter(e => e.status === 'published').length;
    const draft = events.filter(e => e.status === 'draft').length;
    const past = events.filter(e => new Date(e.date) < new Date()).length;
    const review = events.filter(e => e.status === 'review' || e.status === 'in_review').length;

    animateCounter('stat-total', total);
    animateCounter('stat-live', live);
    animateCounter('stat-review', review);
    animateCounter('stat-past', past);
    animateCounter('stat-draft', draft);

    // Revenue
    let totalTickets = 0, totalRevenue = 0, totalScanned = 0, revenueData = null;
    try {
      const { data } = await supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id });
      if (getSwitchId() !== mySwitch) return; // stale
      revenueData = data;
      if (data) {
        data.forEach(r => {
          totalTickets += Number(r.total_tickets_sold);
          totalRevenue += Number(r.net_revenue);
          totalScanned += Number(r.scanned_count);
        });
      }
    } catch (e) { console.warn('Revenue RPC skipped:', e.message); }

    if (getSwitchId() !== mySwitch) return; // final stale check before DOM writes

    const scanRate = totalTickets > 0 ? Math.round((totalScanned / totalTickets) * 100) : 0;
    document.getElementById('ana-tickets').textContent = totalTickets.toLocaleString();
    document.getElementById('ana-revenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('ana-scanrate').textContent = totalTickets > 0 ? scanRate + '%' : '-';

    renderEventsTable(events);
    // H-5: Only attach ticket panel listeners once
    if (!_ticketsPanelInitialized) {
      _ticketsPanelInitialized = true;
      setupTicketsPanel(events);
    }
    populateEventSelects(events);
    initCharts(revenueData, events);
    if (revenueData?.length) renderRevenueBreakdown(revenueData);

    // Feed calendar
    setCalendarEvents(events);
    renderCalendar();

  } catch (err) {
    console.error('Dashboard error:', err);
    const tbody = document.getElementById('events-tbody');
    if (tbody) {
      setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty">${escapeHTML(err.message || 'Failed to load events. Please refresh.')}</td></tr>`);
    }
  }
}

/* ==================================
    NOTIFICATIONS
   ================================== */
function setupNotifications() {
  const bell = document.getElementById('notif-bell');
  const dropdown = document.getElementById('notif-dropdown');

  // ── H-3: set initial aria-expanded ──
  bell?.setAttribute('aria-expanded', 'false');

  // Toggle dropdown
  bell?.addEventListener('click', (e) => {
    if (e.target.closest('.ev-notif-dropdown')) return;
    const isOpen = dropdown?.classList.toggle('open');
    bell.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!bell?.contains(e.target)) {
      dropdown?.classList.remove('open');
      bell?.setAttribute('aria-expanded', 'false');
    }
  });

  // Mark all read
  document.getElementById('notif-clear')?.addEventListener('click', () => {
    localStorage.setItem('ev-last-notif', new Date().toISOString());
    renderNotifications();
  });

  // Load recent ticket purchases as notifications
  loadNotifications();
}

/* ==================================
   USER DROPDOWN (click-toggle + a11y)
   ================================== */
function setupUserDropdownToggle() {
  const userWrap = document.getElementById('user-wrap');
  const userInfo = document.getElementById('user-info');
  if (!userWrap || !userInfo) return;

  // ── H-3: set initial aria state ──
  userInfo.setAttribute('role', 'button');
  userInfo.setAttribute('aria-haspopup', 'true');
  userInfo.setAttribute('aria-expanded', 'false');

  // Click to toggle
  userInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = userWrap.classList.toggle('open');
    userInfo.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!userWrap.contains(e.target)) {
      userWrap.classList.remove('open');
      userInfo.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ==================================
   ADMIN BRIDGE — Inject Motherboard Link
   Only visible to users with role=admin
   ================================== */
function injectAdminBridge(auth) {
  if (auth.profile?.role !== 'admin') return;
  const nav = document.querySelector('.ev-sidebar-nav');
  if (!nav || document.getElementById('admin-bridge-link')) return;

  const divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:rgba(255,255,255,.15);margin:10px 14px';
  nav.appendChild(divider);

  const link = document.createElement('a');
  link.id = 'admin-bridge-link';
  link.href = 'admin.html';
  link.className = 'ev-nav-item';
  link.style.cssText = 'color:#fff;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.12);font-weight:600;margin-top:2px;text-decoration:none';
  link.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#fff">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
    👑 Admin Panel
  `;
  nav.appendChild(link);
}

/* Google Maps variables and constants moved to src/lib/dashboard-modals.js */
