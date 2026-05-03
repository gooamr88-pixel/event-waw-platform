/* ═══════════════════════════════════
   EVENT WAW DASHBOARD — Controller
   Single-file, modular, production-ready
   ═══════════════════════════════════ */

import { resetCreateEventForm, initGooglePlacesAutocomplete, renderGoogleKeywords, showGoogleMapPreview, setupCeUpload, handleCeFileUpload, renderCeTicketsTable, updateCePreview, showEditModal, uploadCoverImage, uploadEventFile } from '../src/lib/dashboard-modals.js';
import { setupCreateModal, loadEventForEditing } from '../src/lib/dashboard-modals.js';
import { setupSearch } from '../src/lib/dashboard-search.js';
import { renderCalendar } from '../src/lib/dashboard-calendar.js';
import { setupEmailAttendees } from '../src/lib/dashboard-attendees.js';
import { setupProfilePanel, setupUserDropdown } from '../src/lib/dashboard-profile.js';
import { setupPayoutPanel, renderRevenueBreakdown, initCharts } from '../src/lib/dashboard-analytics.js';
import { setupPromoPanel, setupApprovalPanel } from '../src/lib/dashboard-vendors.js';
import { loadPromoCodes, setupFinancialPanel } from '../src/lib/dashboard-promos.js';
import { loadPayoutData, setupDarkMode } from '../src/lib/dashboard-payout.js';
import { loadNotifications, renderNotifications, timeAgo, setupCalendar } from '../src/lib/dashboard-notifications.js';
import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { getOrganizerEvents, createEvent, deleteEvent, updateEvent } from '../src/lib/events.js';
import { protectPage, performSignOut } from '../src/lib/guard.js';
import { escapeHTML } from '../src/lib/utils.js';
import { showToast, animateCounter, setupSidebar, setupUserInfo } from '../src/lib/dashboard-ui.js';
import { renderEventsTable, populateEventSelects } from '../src/lib/dashboard-events.js';
import { setupTicketsPanel } from '../src/lib/dashboard-tickets.js';
import { setSafeHTML } from '../src/lib/dom.js';

/* ══════════════════════════════════
   INIT
   ══════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await protectPage({ requireRole: 'organizer' });
  if (!auth) return;

  setupUserInfo(auth);
  setupSidebar();
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

  await loadDashboard();
});

/* ══════════════════════════════════
   SIGN OUT
   ══════════════════════════════════ */
function setupSignOut() {
  document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to sign out?')) {
      await performSignOut('/login.html');
    }
  });
}

/* ══════════════════════════════════
   LOAD DASHBOARD DATA
   ══════════════════════════════════ */
let calEvents = [];

async function loadDashboard() {
  try {
    const user = await getCurrentUser();
    const events = await getOrganizerEvents();

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
      revenueData = data;
      if (data) {
        data.forEach(r => {
          totalTickets += Number(r.total_tickets_sold);
          totalRevenue += Number(r.net_revenue);
          totalScanned += Number(r.scanned_count);
        });
      }
    } catch (e) { console.warn('Revenue RPC skipped:', e.message); }

    const scanRate = totalTickets > 0 ? Math.round((totalScanned / totalTickets) * 100) : 0;
    document.getElementById('ana-tickets').textContent = totalTickets.toLocaleString();
    document.getElementById('ana-revenue').textContent = '$' + totalRevenue.toLocaleString();
    document.getElementById('ana-scanrate').textContent = totalTickets > 0 ? scanRate + '%' : '—';

    renderEventsTable(events);
    setupTicketsPanel(events);
    populateEventSelects(events);
    initCharts(revenueData, events);
    if (revenueData?.length) renderRevenueBreakdown(revenueData);

    // Feed calendar
    calEvents = events;
    renderCalendar();

  } catch (err) {
    console.error('Dashboard error:', err);
    const tbody = document.getElementById('events-tbody');
    if (tbody) {
      setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty">${escapeHTML(err.message || 'Failed to load events. Please refresh.')}</td></tr>`);
    }
  }
}

/* ══════════════════════════════════
   🔔 NOTIFICATIONS
   ══════════════════════════════════ */
function setupNotifications() {
  const bell = document.getElementById('notif-bell');
  const dropdown = document.getElementById('notif-dropdown');

  // Toggle dropdown
  bell?.addEventListener('click', (e) => {
    if (e.target.closest('.ev-notif-dropdown')) return;
    dropdown?.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!bell?.contains(e.target)) dropdown?.classList.remove('open');
  });

  // Mark all read
  document.getElementById('notif-clear')?.addEventListener('click', () => {
    localStorage.setItem('ev-last-notif', new Date().toISOString());
    renderNotifications();
  });

  // Load recent ticket purchases as notifications
  loadNotifications();
}

/* ══════════════════════════════════
   GOOGLE PLACES AUTOCOMPLETE
   ══════════════════════════════════ */
let googleMapInstance = null;
let googleMapMarker = null;
let googleAutocompleteInitialized = false;

/** Country code → timezone mapping for common countries */
const COUNTRY_TIMEZONE_MAP = {
  EG: 'Africa/Cairo', SA: 'Asia/Riyadh', AE: 'Asia/Dubai', US: 'America/New_York',
  CA: 'America/Toronto', GB: 'Europe/London', DE: 'Europe/Berlin', FR: 'Europe/Paris',
  TR: 'Europe/Istanbul', JO: 'Asia/Amman', LB: 'Asia/Beirut', KW: 'Asia/Kuwait',
  QA: 'Asia/Qatar', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', MA: 'Africa/Casablanca',
  TN: 'Africa/Tunis', JP: 'Asia/Tokyo',
};

/** ISO country → select option mapping */
const ISO_TO_SELECT = {
  EG: 'EG', SA: 'SA', AE: 'AE', US: 'US', CA: 'CA', GB: 'GB', DE: 'DE', FR: 'FR',
  TR: 'TR', JO: 'JO', LB: 'LB', KW: 'KW', QA: 'QA', BH: 'BH', OM: 'OM', MA: 'MA', TN: 'TN',
};

/** Country code → default currency */
const COUNTRY_CURRENCY_MAP = {
  EG: 'EGP', SA: 'SAR', AE: 'AED', US: 'USD', CA: 'CAD', GB: 'GBP', DE: 'EUR', FR: 'EUR',
};
