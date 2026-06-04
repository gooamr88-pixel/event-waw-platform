/* ===================================
   EVENTSLI DASHBOARD - Controller
   Single-file, modular, production-ready
   =================================== */

import { resetCreateEventForm, initGooglePlacesAutocomplete, renderGoogleKeywords, showGoogleMapPreview, setupCeUpload, handleCeFileUpload, renderCeTicketsTable, updateCePreview, showEditModal, uploadCoverImage, uploadEventFile } from '../src/lib/dashboard-modals.js';
import { setupCreateModal, loadEventForEditing } from '../src/lib/dashboard-modals.js';
import { setupSearch } from '../src/lib/dashboard-search.js';
import { renderCalendar, setupCalendar, setCalendarEvents } from '../src/lib/dashboard-calendar.js';
import { setupEmailAttendees } from '../src/lib/dashboard-attendees.js';
import { setupProfilePanel, setupUserDropdown } from '../src/lib/dashboard-profile.js';
import { renderRevenueBreakdown, initCharts } from '../src/lib/dashboard-analytics.js';
import { setupPromoPanel } from '../src/lib/dashboard-vendors.js';
import { loadPromoCodes, setupFinancialPanel, setupPromoForm } from '../src/lib/dashboard-promos.js';
import { loadPayoutData, setupDarkMode, setupPayoutPanel } from '../src/lib/dashboard-payout.js';
import { loadNotifications, renderNotifications, timeAgo } from '../src/lib/dashboard-notifications.js';
import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { getOrganizerEvents, createEvent, deleteEvent, updateEvent } from '../src/lib/events.js';
import { protectPage, performSignOut } from '../src/lib/guard.js';
import { showConfirmModal } from '../src/lib/ui-modals.js';
import { escapeHTML, formatCurrency } from '../src/lib/utils.js';
import { showToast, animateCounter, setupSidebar, setupUserInfo, setupGlobalKeyboardManager, getSwitchId } from '../src/lib/dashboard-ui.js';
import { renderEventsTable, populateEventSelects, showTableSkeleton } from '../src/lib/dashboard-events.js';
import { setupTicketsPanel } from '../src/lib/dashboard-tickets.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { onDashboardAction } from '../src/lib/dashboard-bus.js';
import { setupGateTeamPanel } from '../src/lib/dashboard-gate-team.js';
import { renderManualOrdersPanel } from '../src/lib/dashboard-manual-orders.js?v=20260525_3';
import { renderCommissionDebtCard } from '../src/lib/commission-debt.js';

// H-5: Guard to prevent duplicate listener attachment on setupTicketsPanel
let _ticketsPanelInitialized = false;

/* ==================================
   INIT
   ================================== */
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await protectPage({ requireRole: 'organizer' });
  if (!auth) return;

  setupUserInfo(auth);
  injectAdminBridge(auth);
  setupSidebar();
  setupCreateModal();
  setupSearch();
  setupSignOut();

  // setupApprovalPanel removed — Vendor role amputated
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
  setupGateTeamPanel();
  setupManualOrdersPanel();    // HYBRID PAYMENT: Pending Transfers panel
  loadPromoCodes();            // Initial load for promos

  setupGlobalKeyboardManager(); // H-3: Escape key handler
  setupUserDropdownToggle();    // P3-2: Wire click-toggle + aria-expanded for user dropdown

  // Register actions on the event bus (replaces window.* globals)
  onDashboardAction('refreshDashboard', loadDashboard);
  onDashboardAction('editEvent', loadEventForEditing);

  await loadDashboard();

  // ── Stripe Connect banner (non-blocking) ──
  setupStripeBanner(auth);
});

/* ==================================
   STRIPE CONNECT ONBOARDING BANNER
   Shows in main dashboard for organizers
   who haven't connected their Stripe account.
   ================================== */
const SUPABASE_FUNCTIONS_URL = 'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1';

async function setupStripeBanner(auth) {
  const banner = document.getElementById('stripe-connect-banner');
  const btn = document.getElementById('stripe-banner-btn');
  const title = document.getElementById('stripe-banner-title');
  const badge = document.getElementById('stripe-banner-badge');
  const desc = document.getElementById('stripe-banner-desc');
  if (!banner || !btn) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/stripe-onboarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'check-status' }),
    });

    if (!res.ok) {
      // If 403 (not an organizer), hide banner
      banner.style.display = 'none';
      return;
    }

    const data = await res.json();

    if (data.onboarding_complete) {
      // ── CONNECTED ──
      banner.className = 'ev-stripe-banner stripe-connected';
      title.textContent = 'Stripe Connected';
      badge.textContent = 'Active';
      desc.textContent = 'Your payment account is verified and ready to accept ticket sales. You\'re all set!';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Connected
      `;
      btn.disabled = true;
      banner.style.display = 'block';

      // Auto-hide connected banner after 8 seconds
      setTimeout(() => {
        banner.style.transition = 'opacity .5s, max-height .5s';
        banner.style.opacity = '0';
        banner.style.maxHeight = '0';
        banner.style.overflow = 'hidden';
        banner.style.marginBottom = '0';
      }, 8000);

    } else if (data.status === 'pending') {
      // ── PENDING (account created, onboarding incomplete) ──
      banner.className = 'ev-stripe-banner stripe-pending';
      title.innerHTML = 'Stripe Setup Incomplete <button id="stripe-dismiss-btn" style="float:right; background:transparent; border:none; color:inherit; font-size:1.2rem; cursor:pointer;">✕</button>';
      badge.textContent = 'Pending';
      desc.textContent = 'Your Stripe account was created but setup isn\'t finished. Complete it to start selling tickets.';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Continue Setup
      `;
      banner.style.display = 'block';

      // Allow user to dismiss
      setTimeout(() => {
        const dismissBtn = document.getElementById('stripe-dismiss-btn');
        if (dismissBtn) {
          dismissBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            banner.style.display = 'none';
          });
        }
      }, 100);

    } else {
      // ── NOT STARTED ──
      banner.className = 'ev-stripe-banner';
      title.textContent = 'Connect Your Stripe Account';
      badge.textContent = 'Required';
      desc.textContent = 'To sell tickets and receive payouts, you need to connect a Stripe account. This is a one-time setup.';
      banner.style.display = 'block';
    }

  } catch (err) {
    console.warn('Stripe banner check failed (non-blocking):', err);
    // Show banner in default state anyway
    banner.style.display = 'block';
  }

  // ── Click handler: initiate onboarding ──
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <div style="width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:evSpin .7s linear infinite"></div>
      Connecting…
    `;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showToast('⚠️ Please sign in again to connect Stripe.', 'error');
        return;
      }

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/stripe-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'onboard' }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${res.status}`);
      }

      const data = await res.json();
      if (data.url) {
        showToast('🔗 Redirecting to Stripe…', 'info');
        setTimeout(() => { window.location.href = data.url; }, 400);
      } else {
        throw new Error('No onboarding URL returned');
      }
    } catch (err) {
      console.error('Stripe onboarding error:', err);
      showToast(`❌ Stripe connection failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });
}

/* ==================================
   SIGN OUT
   ================================== */
function setupSignOut() {
  document.getElementById('signout-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirmModal({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out?',
      confirmText: 'Sign Out',
      confirmColor: '#dc2626'
    });
    if (confirmed) {
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
    populateEventSelects(events);
    // H-5: Only attach ticket panel listeners once (AFTER selects are populated)
    if (!_ticketsPanelInitialized) {
      _ticketsPanelInitialized = true;
      setupTicketsPanel(events);
    }
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
    e.stopPropagation(); // H-6: Prevent event from bubbling and immediately closing the dropdown
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
  if (!['super_admin', 'admin', 'moderator'].includes(auth.profile?.role)) return;
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

/* ==================================
   MANUAL ORDERS PANEL — Pending Transfers
   Wires the sidebar nav item + panel container for
   manual transfer order management.
   ================================== */
function setupManualOrdersPanel() {
  // Wire sidebar nav if it exists
  const navItem = document.querySelector('[data-panel="manual-orders"]');
  if (navItem) {
    navItem.addEventListener('click', () => {
      const container = document.getElementById('manual-orders-body');
      if (container) renderManualOrdersPanel(container);
    });
  }

  // Load commission debt card when financial panel is opened
  const finNavItem = document.querySelector('[data-panel="financial"]');
  if (finNavItem) {
    const origClick = finNavItem.onclick;
    finNavItem.addEventListener('click', () => {
      // Render commission debt card after a short delay (financial panel loads first)
      setTimeout(() => {
        const debtContainer = document.getElementById('commission-debt-container');
        if (debtContainer) renderCommissionDebtCard(debtContainer);
      }, 500);
    });
  }
}

/* Google Maps variables and constants moved to src/lib/dashboard-modals.js */
