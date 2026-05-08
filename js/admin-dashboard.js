/* ===================================
   EVENT WAW — Admin Motherboard Controller
   ===================================
   Orchestrates the Super Admin Dashboard.
   Guards access to admin role only.
   Manages panel switching and delegates 
   to modular controllers.
   =================================== */

import { supabase } from '../src/lib/supabase.js';
import { protectPage } from '../src/lib/guard.js';
import { 
  applyTheme, setupDarkMode, setupUserInfo, setupClock, 
  animateStat, showToast, setupTableSearch 
} from './admin-ui.js';
import { 
  setupNavigation, switchPanel, setupHeaderShortcuts, 
  setupUserDropdown, setupMobileToggle, setupSignOut
} from './admin-navigation.js';
import { loadApprovalQueue } from './admin-approvals.js';
import { loadAllUsers } from './admin-users.js';
import { loadAllEvents } from './admin-events-all.js';
import { loadCMSPanel, setupCMSEvents } from './admin-cms-controller.js';

let currentPanel = 'dashboard';
let adminRole = 'moderator';
const loadedPanels = new Set(['dashboard']);

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const auth = await protectPage({ requireRole: 'admin' });
    if (!auth) return;

    adminRole = auth.profile?.role || 'moderator';

    // UI Init
    applyTheme();
    setupUserInfo(auth, adminRole);
    setupDarkMode();
    setupClock();
    setupUserDropdown();
    setupMobileToggle();
    setupSignOut();
    setupCMSEvents();
    
    // Navigation Init
    setupNavigation(switchPanelWithData);
    setupHeaderShortcuts(switchPanelWithData);
    
    // Permissions
    enforceRolePermissions();

    // Table Search
    setupTableSearch('search-approvals', 'approvals-tbody');
    setupTableSearch('search-users', 'users-tbody');
    setupTableSearch('search-all-events', 'all-events-tbody');

    // Initial Load
    await loadDashboardData();
  } catch (err) {
    console.error("FATAL ADMIN INIT ERROR:", err);
    alert("Dashboard Initialization Error: " + err.message);
  }
});

/**
 * Enhanced panel switcher that also triggers data loading.
 */
async function switchPanelWithData(panelId) {
  if (panelId === currentPanel) return;
  switchPanel(panelId);
  currentPanel = panelId;
  await loadPanelData(panelId);
}

/**
 * Loads the platform stats for the dashboard.
 */
export async function loadDashboardData() {
  try {
    const { data, error } = await supabase.rpc('admin_get_platform_stats');
    if (error) throw error;

    if (data && data.length > 0) {
      const stats = data[0];
      animateStat('stat-users',      stats.total_users);
      animateStat('stat-organizers',  stats.total_organizers);
      animateStat('stat-events',     stats.total_events);
      animateStat('stat-pending',    stats.pending_approval);
      animateStat('stat-revenue',    stats.total_revenue, '$');
      animateStat('stat-tickets',    stats.total_tickets);

      const badge = document.getElementById('pending-count');
      if (badge && stats.pending_approval > 0) {
        badge.textContent = stats.pending_approval;
        badge.style.display = '';
      }
    }
    initRevenueChart();
  } catch (err) {
    console.error('Dashboard load error:', err);
    showToast('Dashboard load failed: ' + err.message, 'error');
  }
}

/**
 * Orchestrates lazy-loading of panel data.
 */
async function loadPanelData(panelId, force = false) {
  if (loadedPanels.has(panelId) && !force) return;
  loadedPanels.add(panelId);

  const refresh = () => {
    loadedPanels.delete(panelId);
    loadedPanels.delete('dashboard');
    loadPanelData(panelId, true);
    loadDashboardData();
  };

  switch (panelId) {
    case 'approvals': await loadApprovalQueue(refresh); break;
    case 'users':     await loadAllUsers(adminRole, refresh); break;
    case 'events-all': await loadAllEvents(refresh); break;
    case 'cms':        await loadCMSPanel(); break;
  }
}

function enforceRolePermissions() {
  const panelRules = { 'users': 'admin', 'cms': 'super_admin' };
  const getLevel = (r) => ({ super_admin: 3, admin: 2, moderator: 1 }[r] || 0);
  const myLevel = getLevel(adminRole);

  document.querySelectorAll('.ev-nav-item[data-panel], .ev-header-link[data-panel]').forEach(item => {
    const minRole = panelRules[item.dataset.panel];
    if (minRole && myLevel < getLevel(minRole)) item.style.display = 'none';
  });

  const mmToggle = document.getElementById('admin-maintenance-toggle');
  if (mmToggle && myLevel < 3) {
    const wrap = mmToggle.closest('div[style*="display:flex"]');
    if (wrap) wrap.style.display = 'none';
  }
}

function initRevenueChart() {
  const ctx = document.getElementById('admin-revenue-chart');
  if (!ctx || window.adminChartInstance) return;
  window.adminChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [
        { label: 'Ticket Sales', data: [120, 190, 300, 250, 400, 450, 500], borderColor: '#059669', backgroundColor: 'rgba(5, 150, 105, 0.1)', borderWidth: 2, fill: true, tension: 0.4 },
        { label: 'Platform Revenue ($)', data: [300, 450, 700, 600, 1000, 1200, 1500], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, fill: true, tension: 0.4 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
  });
}
