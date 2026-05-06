/* ===================================
   EVENT WAW - Seating Chart UI Integration
   Bridges SeatingChart engine with event-detail page
   =================================== */

import { SeatingChart } from './seating-chart.js';
import { createSeatedCheckout, createGuestSeatedCheckout } from './events.js';
import { setSafeHTML } from './dom.js';
import { showAlertModal } from './ui-modals.js';

/**
 * Initialize the seating chart UI on the event-detail page.
 * Returns true if a venue map was found (seated event), false for GA fallback.
 *
 * @param {string} eventId - The event UUID
 * @param {HTMLElement} mountEl - Where to mount the seating chart panel
 * @param {object} options - { onCheckout: fn, isGuest: bool }
 */
export async function initSeatingUI(eventId, mountEl, options = {}) {
  if (!mountEl) return false;

  // Build the shell HTML
  setSafeHTML(mountEl, `
    <div id="seating-panel" style="display:none;">
      <div class="seating-header">
        <div class="seating-header-title"> Choose Your <span style="color:var(--accent-primary)">Seats</span></div>
        <div class="seating-header-badge"><span class="pulse-dot"></span> Live availability</div>
      </div>

      <div class="seating-hint">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>Click seats to select them. Scroll to zoom, drag to pan. All seats in a selection must be from the same tier.</span>
      </div>

      <div id="seating-chart-mount" class="seating-chart-container"></div>

      <div id="seating-legend" class="seating-legend"></div>

      <div id="seating-selection-bar" class="seating-selection-bar" style="display:none;">
        <div class="seating-selection-info">
          <div class="seating-selection-count" id="selection-count-text">No seats selected</div>
          <div class="seating-selection-total" id="selection-total-text">$0</div>
        </div>
        <div class="seating-selection-actions">
          <button class="btn btn-outline btn-sm" id="clear-seats-btn">Clear</button>
          <button class="btn btn-primary btn-sm btn-pulse" id="checkout-seats-btn" disabled>
            Checkout
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
          </button>
        </div>
      </div>
    </div>
  `);

  const chartContainer = document.getElementById('seating-chart-mount');
  const panel = document.getElementById('seating-panel');

  // Initialize the chart engine
  const chart = new SeatingChart(chartContainer, eventId, {
    maxSelectable: 10,
    onSelectionChange: (seats) => updateSelectionBar(seats, chart),
  });

  const hasMap = await chart.init();

  if (!hasMap) {
    mountEl.textContent = '';
    return false;
  }

  // Show the panel
  panel.style.display = 'block';

  // Render tier legend
  renderLegend(chart);

  // Wire up buttons
  document.getElementById('clear-seats-btn')?.addEventListener('click', () => {
    chart.clearSelection();
  });

  document.getElementById('checkout-seats-btn')?.addEventListener('click', async () => {
    const seats = chart.getSelectedSeats();
    if (seats.length === 0) return;

    const btn = document.getElementById('checkout-seats-btn');
    btn.disabled = true;
    setSafeHTML(btn, '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(0,0,0,.3);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.6s linear infinite;"></span> Reserving...');

    try {
      const tierId = chart.getSelectedTierId();
      const seatIds = seats.map(s => s.seat_id);

      if (options.onCheckout) {
        // Delegate to the page-level handler (for guest modal etc)
        await options.onCheckout({ tierId, seatIds, seats });
      } else {
        // Default: straight authenticated checkout
        const result = await createSeatedCheckout({ tierId, seatIds });
        if (result.checkout_url) {
          window.location.href = result.checkout_url;
        }
      }
    } catch (err) {
      await showAlertModal({
        title: 'Error',
        message: err.message || 'Failed to reserve seats. Please try again.',
        buttonColor: '#dc2626'
      });
    } finally {
      btn.disabled = false;
      setSafeHTML(btn, 'Checkout <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>');
    }
  });

  // Store reference for cleanup
  mountEl._seatingChart = chart;

  return true;
}

/**
 * Render the tier legend with click-to-filter.
 */
function renderLegend(chart) {
  const container = document.getElementById('seating-legend');
  if (!container) return;

  const legend = chart.getTierLegend();
  setSafeHTML(container, legend.map(t => `
    <div class="seating-legend-item" data-tier-id="${t.tier_id}">
      <span class="seating-legend-dot" style="background:${t.color}"></span>
      <span class="seating-legend-name">${escapeHTML(t.tier_name)}</span>
      <span class="seating-legend-price">$${Number(t.tier_price).toLocaleString()}</span>
      <span class="seating-legend-avail">${t.available}/${t.total} left</span>
    </div>
  `).join('') + `
    <div class="seating-legend-item" data-tier-id="__status__" style="gap:14px;">
      <span style="display:flex;align-items:center;gap:4px;"><span class="seating-legend-dot" style="background:var(--seat-sold);width:8px;height:8px;opacity:.4"></span><span style="font-size:0.7rem;color:var(--text-muted)">Sold</span></span>
      <span style="display:flex;align-items:center;gap:4px;"><span class="seating-legend-dot" style="background:#fff;width:8px;height:8px;border:2px solid var(--accent-primary)"></span><span style="font-size:0.7rem;color:var(--text-muted)">Selected</span></span>
    </div>
  `);

  // Click to filter by tier
  let activeTier = null;
  container.querySelectorAll('.seating-legend-item[data-tier-id]').forEach(el => {
    el.addEventListener('click', () => {
      const tierId = el.dataset.tierId;
      if (tierId === '__status__') return;

      if (activeTier === tierId) {
        // Deselect
        activeTier = null;
        chart.setActiveTier(null);
        container.querySelectorAll('.seating-legend-item').forEach(e => e.classList.remove('active'));
      } else {
        activeTier = tierId;
        chart.setActiveTier(tierId);
        container.querySelectorAll('.seating-legend-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
      }
    });
  });
}

/**
 * Update the selection summary bar when seats are clicked.
 */
function updateSelectionBar(seats, chart) {
  const bar = document.getElementById('seating-selection-bar');
  const countText = document.getElementById('selection-count-text');
  const totalText = document.getElementById('selection-total-text');
  const checkoutBtn = document.getElementById('checkout-seats-btn');

  if (!bar || !countText || !totalText || !checkoutBtn) return;

  if (seats.length === 0) {
    bar.style.display = 'none';
    bar.classList.remove('has-selection');
    checkoutBtn.disabled = true;
    return;
  }

  bar.style.display = 'flex';
  bar.classList.add('has-selection');
  checkoutBtn.disabled = false;

  const total = seats.reduce((sum, s) => sum + Number(s.tier_price), 0);
  const tierName = seats[0]?.tier_name || 'Selected';

  setSafeHTML(countText, `<strong>${seats.length}</strong> seat${seats.length !== 1 ? 's' : ''}  ${escapeHTML(tierName)}`);
  totalText.textContent = `$${total.toLocaleString()}`;

  // Also update legend availability counts
  renderLegendCounts(chart);
}

function renderLegendCounts(chart) {
  const legend = chart.getTierLegend();
  for (const t of legend) {
    const el = document.querySelector(`.seating-legend-item[data-tier-id="${t.tier_id}"] .seating-legend-avail`);
    if (el) el.textContent = `${t.available}/${t.total} left`;
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
