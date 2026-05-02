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
import { setupPromoPanel } from '../src/lib/dashboard-vendors.js';
import { loadPromoCodes, setupFinancialPanel } from '../src/lib/dashboard-promos.js';
import { loadPayoutData, setupDarkMode } from '../src/lib/dashboard-payout.js';
import { loadNotifications, renderNotifications, timeAgo, setupCalendar } from '../src/lib/dashboard-notifications.js';
import { supabase, getCurrentUser, getCurrentProfile } from '../src/lib/supabase.js';
import { getOrganizerEvents, createEvent, deleteEvent, updateEvent } from '../src/lib/events.js';
import { protectPage, performSignOut } from '../src/lib/guard.js';
import { escapeHTML } from '../src/lib/utils.js';

/* ══════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════ */

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

/* ── User Info ── */

/* ── Sign Out ── */

/* ══════════════════════════════════
   SIDEBAR NAVIGATION
   ══════════════════════════════════ */


/* ══════════════════════════════════
   LOAD DASHBOARD DATA
   ══════════════════════════════════ */
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
    document.getElementById('events-tbody').innerHTML =
      `<tr><td colspan="8" class="ev-table-empty">${escapeHTML(err.message || 'Failed to load events. Please refresh.')}</td></tr>`;
  }
}

/* ── Animated Counter ── */

/* ══════════════════════════════════
   EVENTS TABLE
   ══════════════════════════════════ */





/* ══════════════════════════════════
   POPULATE EVENT SELECTS
   ══════════════════════════════════ */

/* ══════════════════════════════════
   TICKETS PANEL
   ══════════════════════════════════ */

/* ══════════════════════════════════
   CHARTS
   ══════════════════════════════════ */
let revenueChartInstance = null, tierChartInstance = null;


/* ══════════════════════════════════
   REVENUE BREAKDOWN
   ══════════════════════════════════ */
   SEARCH
   ══════════════════════════════════ */

/* ══════════════════════════════════
   CREATE EVENT PANEL (Full Page Wizard)
   ══════════════════════════════════ */
let ceTicketCategories = [];
let ceTicketsList = [];
let ceGalleryCount = 1;
let ceTicketTableListenerAttached = false;
let ceKeywords = [];
let ceEditingEventId = null;

/* ── Load Event for Editing ── */


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









/* ══════════════════════════════════
   EDIT EVENT MODAL
   ══════════════════════════════════ */

/* ══════════════════════════════════
   APPROVAL PANEL
   ══════════════════════════════════ */

function setupApprovalPanel() {
  // Tab switching

async function loadApprovalData() {
  const tbody = document.getElementById('approval-tbody');
  const openModal = () => modal?.classList.add('active');
  const closeModal = () => modal?.classList.remove('active');

  document.getElementById('new-promo-btn')?.addEventListener('click', openModal);
    const user = await getCurrentUser();
  loadFinancialData();
}

async function loadFinancialData() {
  tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';

  document.getElementById('payout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
      .eq('id', user.id)

  document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('ev-dash-dark', document.body.classList.contains('dark-mode'));
  });
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
    if (!events?.length) return;
  bell?.querySelector('.ev-notif-badge')?.remove();
  return `${days}d ago`;
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    calMonth = new Date().getMonth();
    calYear = new Date().getFullYear();
    renderCalendar();
  });
}


/* ══════════════════════════════════
   📸 COVER IMAGE UPLOAD
   ══════════════════════════════════ */



/* ══════════════════════════════════
   📧 EMAIL ATTENDEES
   ══════════════════════════════════ */

/* ══════════════════════════════════
   👤 USER DROPDOWN
   ══════════════════════════════════ */

/* ══════════════════════════════════
   🏢 ORGANIZER PROFILE PANEL
   ══════════════════════════════════ */

async function loadProfileData() {
  try {
    const user = await getCurrentUser();
    const { data } = await supabase
      .from('profiles')
      .select('organizer_profile')
      .eq('id', user.id)
      .single();

    if (data?.organizer_profile) {
      const p = data.organizer_profile;
      if (p.brand_name) document.getElementById('prof-brand').value = p.brand_name;
      if (p.address) document.getElementById('prof-address').value = p.address;
      if (p.bio) document.getElementById('prof-bio').value = p.bio;
      if (p.phone) document.getElementById('prof-phone').value = p.phone;
      if (p.website) document.getElementById('prof-website').value = p.website;
      if (p.payment_method) document.getElementById('prof-payment').value = p.payment_method;
      if (p.social) {
        if (p.social.instagram) document.getElementById('prof-ig').value = p.social.instagram;
        if (p.social.tiktok) document.getElementById('prof-tiktok').value = p.social.tiktok;
        if (p.social.facebook) document.getElementById('prof-fb').value = p.social.facebook;
        if (p.social.x) document.getElementById('prof-x').value = p.social.x;
        if (p.social.linkedin) document.getElementById('prof-linkedin').value = p.social.linkedin;
      }
    }
  } catch (_) { /* No profile data yet */ }
}
