/* ===================================
   EVENTSLI - Seating Chart UI Integration
   Bridges SeatingChart engine with event-detail page
   =================================== */

import { SeatingChart } from './seating-chart.js?v=4';
import { createSeatedCheckout, createGuestSeatedCheckout } from './events.js';
import { getOrderBreakdown, renderPriceBreakdown, injectBreakdownStyles } from './price-breakdown.js';
import { setSafeHTML } from './dom.js';
import { showAlertModal } from './ui-modals.js';
import { escapeHTML, formatCurrency } from './utils.js';
import { supabase } from './supabase.js';

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
        <span>Click seats to select them. Scroll to zoom, drag to pan.</span>
      </div>

      <div id="category-filters-container" style="display:none; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;"></div>

      <div id="seating-chart-mount" class="seating-chart-container"></div>

      <div id="seating-legend" class="seating-legend"></div>

      <div id="seating-selection-bar" class="seating-selection-bar" style="display:none; flex-direction: column; align-items: stretch; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 12px; flex-wrap: wrap;">
          <div class="seating-selection-info">
            <div class="seating-selection-count" id="selection-count-text">No seats selected</div>
            <div class="seating-selection-total" id="selection-total-text">$0</div>
          </div>
          <div class="seating-selection-actions">
            <button class="btn btn-outline btn-sm" id="clear-seats-btn">Clear</button>
            <button class="btn btn-primary btn-sm" id="checkout-seats-btn" disabled>
              احجز الآن / Checkout
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
            </button>
          </div>
        </div>
        <!-- V52 FIX: Payment method selector for seated checkout (populated by event-detail.html) -->
        <div id="seat-payment-method-selector" style="display:none;width:100%;">
          <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:5px;display:block;">Payment Method</label>
          <select class="fi" id="seat-payment-method-select" style="width:100%;font-size:0.85rem;padding:8px 12px;">
            <option value="stripe">💳 Credit/Debit Card (Stripe)</option>
          </select>
        </div>
        <!-- BRD: Server-side price breakdown (tax + service fee + total) -->
        <div id="seat-price-breakdown" style="width:100%;"></div>
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

  // Render category filters
  renderCategoryFilters(chart);

  // Check if a promo code is already applied in the DOM and pass it to the chart
  const promoInput = document.getElementById('promo-input');
  if (promoInput && promoInput.disabled && promoInput.value) {
    chart.setPromoCode(promoInput.value);
  }

  // Wire up buttons
  document.getElementById('clear-seats-btn')?.addEventListener('click', () => {
    chart.clearSelection();
  });

  document.getElementById('checkout-seats-btn')?.addEventListener('click', async () => {
    const seats = chart.getSelectedSeats();
    if (seats.length === 0) return;

    // V52 FIX: Read payment method from seated selector
    const seatPaySelect = document.getElementById('seat-payment-method-select');
    const selectedMethod = seatPaySelect?.value || 'stripe';

    const btn = document.getElementById('checkout-seats-btn');
    btn.disabled = true;
    setSafeHTML(btn, '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(0,0,0,.3);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.6s linear infinite;"></span> Reserving...');

    try {
      const seatIds = seats.map(s => s.seat_id);

      if (options.onCheckout) {
        // v62: Pass seatIds instead of single tierId — mixed tiers supported
        await options.onCheckout({ tierId: seats[0]?.tier_id, seatIds, seats, selectedMethod });
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
      const btnLabel = selectedMethod !== 'stripe'
        ? '📱 Pay & Reserve'
        : 'احجز الآن / Checkout';
      setSafeHTML(btn, btnLabel + ' <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>');
    }
  });

  // Store reference for cleanup
  mountEl._seatingChart = chart;

  // H-13 FIX: Clean up polling interval on page unload
  window.addEventListener('beforeunload', () => {
    if (mountEl._seatingChart && typeof mountEl._seatingChart.destroy === 'function') {
      mountEl._seatingChart.destroy();
    }
  });

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
      <span class="seating-legend-price">${formatCurrency(Number(t.tier_price), t.currency)}</span>
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

// Debounce timer + cached breakdown for seated checkout
let seatBreakdownDebounce = null;
let cachedSeatBreakdown = null;

/**
 * Export cached breakdown so event-detail.html can read it for the guest modal.
 */
export function getCachedSeatBreakdown() {
  return cachedSeatBreakdown;
}

/**
 * Update the selection summary bar when seats are clicked.
 * BRD: Must show ticket price + tax + service fee + total before payment.
 */
function updateSelectionBar(seats, chart) {
  const bar = document.getElementById('seating-selection-bar');
  const countText = document.getElementById('selection-count-text');
  const totalText = document.getElementById('selection-total-text');
  const checkoutBtn = document.getElementById('checkout-seats-btn');
  const breakdownContainer = document.getElementById('seat-price-breakdown');

  if (!bar || !countText || !totalText || !checkoutBtn) return;

  if (seats.length === 0) {
    bar.style.display = 'none';
    bar.classList.remove('has-selection');
    checkoutBtn.disabled = true;
    cachedSeatBreakdown = null;
    if (breakdownContainer) breakdownContainer.innerHTML = '';
    clearTimeout(seatBreakdownDebounce);
    return;
  }

  bar.style.display = 'flex';
  bar.classList.add('has-selection');
  checkoutBtn.disabled = false;

  // v62: Sum effective per-seat prices instead of flat tier price
  const total = seats.reduce((sum, s) => sum + Number(s.effective_price ?? s.tier_price), 0);

  // v62: Show mixed tier names when seats from different tiers are selected
  const uniqueTiers = [...new Set(seats.map(s => s.tier_name).filter(Boolean))];
  const tierLabel = uniqueTiers.length <= 1
    ? (uniqueTiers[0] || 'Selected')
    : `${uniqueTiers.length} tiers`;

  setSafeHTML(countText, `<strong>${seats.length}</strong> seat${seats.length !== 1 ? 's' : ''}  ${escapeHTML(tierLabel)}`);
  const eventCurrency = document.getElementById('seating-container')?.dataset?.currency || 'USD';
  totalText.textContent = formatCurrency(total, eventCurrency);

  // ── BRD: Fetch server-side breakdown with tax + service fee (debounced) ──
  // v62: Use calculate_seated_breakdown RPC for per-seat pricing
  if (breakdownContainer) {
    clearTimeout(seatBreakdownDebounce);
    seatBreakdownDebounce = setTimeout(async () => {
      try {
        injectBreakdownStyles();
        breakdownContainer.innerHTML = '<div class="ev-breakdown ev-breakdown--loading">Calculating fees…</div>';

        const promoInput = document.getElementById('promo-input');
        const promoCode = (promoInput && promoInput.disabled) ? promoInput.value.trim().toUpperCase() : null;

        const seatIds = seats.map(s => s.seat_id);
        const { data: breakdown, error: bErr } = await supabase
          .rpc('calculate_seated_breakdown', {
            p_seat_ids: seatIds,
            p_promo_code: promoCode,
          });

        if (bErr || !breakdown) {
          // Fallback to legacy tier-based breakdown
          const tierId = seats[0]?.tier_id;
          if (tierId) {
            const fallback = await getOrderBreakdown(tierId, seats.length, promoCode);
            cachedSeatBreakdown = fallback;
            renderPriceBreakdown(breakdownContainer, fallback, { compact: true });
            if (fallback?.total != null) {
              totalText.textContent = formatCurrency(Number(fallback.total), fallback.currency || eventCurrency);
            }
          } else {
            cachedSeatBreakdown = null;
            breakdownContainer.innerHTML = '';
          }
          return;
        }

        cachedSeatBreakdown = breakdown;
        renderPriceBreakdown(breakdownContainer, breakdown, { compact: true });

        // Update the header total to match server total (includes tax + fees)
        if (breakdown?.total != null) {
          totalText.textContent = formatCurrency(Number(breakdown.total), breakdown.currency || eventCurrency);
        }
      } catch (err) {
        console.warn('Seat breakdown fetch failed, using local total:', err);
        cachedSeatBreakdown = null;
        breakdownContainer.innerHTML = '';
      }
    }, 400);
  }

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

/**
 * Render category-based filter pills in the seating chart.
 * Unlocks or highlights selected categories (VIP, accessible, etc.).
 */
function renderCategoryFilters(chart) {
  const container = document.getElementById('category-filters-container');
  if (!container) return;

  const categories = new Set();
  for (const d of chart.seatData.values()) {
    if (d.seat_category && d.seat_category !== 'standard') {
      categories.add(d.seat_category);
    }
  }

  if (categories.size === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';

  const CATEGORY_LABELS = {
    vip: { label: 'VIP', icon: '⭐' },
    premium: { label: 'Premium', icon: '✨' },
    accessible: { label: 'Accessible', icon: '♿' },
    restricted_view: { label: 'Obstructed View', icon: '⚠️' },
    companion: { label: 'Companion', icon: '👥' }
  };

  setSafeHTML(container, `
    <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-right:4px;">Filter seats:</span>
    <button class="btn btn-outline btn-xs active" data-category="all" style="padding: 2px 8px; font-size: 0.7rem; border-radius: 4px;">All</button>
    ` + [...categories].map(cat => {
      const meta = CATEGORY_LABELS[cat] || { label: cat, icon: '🏷️' };
      return `<button class="btn btn-outline btn-xs" data-category="${cat}" style="padding: 2px 8px; font-size: 0.7rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">${meta.icon} ${meta.label}</button>`;
    }).join('')
  );

  container.querySelectorAll('button[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category;
      container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chart.setActiveCategory(cat === 'all' ? null : cat);
    });
  });
}


