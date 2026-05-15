/* ===================================
   EVENTSLI — Price Breakdown Module
   Phase 2 Task 4: Transparent pricing display
   BRD Section 6: "يجب أن يرى المشتري تفصيل السعر"
   =================================== */

import { supabase } from './supabase.js';

/**
 * Fetch the full price breakdown from the server.
 * Calls the calculate_order_breakdown RPC (SECURITY DEFINER).
 * This is the SINGLE SOURCE OF TRUTH for all pricing.
 *
 * @param {string} tierId - Ticket tier UUID
 * @param {number} quantity - Number of tickets
 * @param {string|null} promoCode - Optional promo code
 * @returns {Promise<Object>} Server-calculated breakdown
 */
export async function getOrderBreakdown(tierId, quantity = 1, promoCode = null) {
  const { data, error } = await supabase
    .rpc('calculate_order_breakdown', {
      p_tier_id: tierId,
      p_quantity: quantity,
      p_promo_code: promoCode || null,
    });

  if (error) {
    console.error('Breakdown RPC error:', error);
    throw new Error(error.message || 'Failed to calculate pricing');
  }

  return data;
}

/**
 * Format a number as currency.
 * @param {number} amount
 * @param {string} currency - ISO 4217 code (e.g. 'USD', 'SAR', 'EGP')
 * @returns {string} Formatted string like "$12.50" or "12.50 SAR"
 */
function formatCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Render the price breakdown UI into a container element.
 * BRD: "سعر التذكرة + الضريبة + رسوم الخدمة = المجموع النهائي"
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {Object} breakdown - The breakdown object from getOrderBreakdown()
 * @param {Object} [options] - Display options
 * @param {boolean} [options.showOrganizerNet=false] - Show organizer's net (for dashboard only)
 * @param {boolean} [options.compact=false] - Compact layout for modals
 */
export function renderPriceBreakdown(container, breakdown, options = {}) {
  if (!container || !breakdown) return;

  const cur = (breakdown.currency || 'USD').toUpperCase();
  const fc = (amt) => formatCurrency(amt, cur);
  const { showOrganizerNet = false, compact = false } = options;

  // Determine which rows to show
  const hasDiscount = breakdown.promo_discount > 0;
  const hasTax = breakdown.tax_enabled && breakdown.tax_amount > 0;
  const hasFee = breakdown.platform_fee_total > 0;
  const isFree = breakdown.total === 0;

  if (isFree) {
    container.innerHTML = `
      <div class="ev-breakdown" data-compact="${compact}">
        <div class="ev-breakdown__row ev-breakdown__total">
          <span class="ev-breakdown__label">Total</span>
          <span class="ev-breakdown__value">Free</span>
        </div>
      </div>`;
    return;
  }

  let html = `<div class="ev-breakdown" data-compact="${compact}">`;

  // Row 1: Unit price × Quantity
  html += `
    <div class="ev-breakdown__row">
      <span class="ev-breakdown__label">
        ${breakdown.tier_name} × ${breakdown.quantity}
      </span>
      <span class="ev-breakdown__value">${fc(breakdown.subtotal)}</span>
    </div>`;

  // Row 2: Promo discount (if any)
  if (hasDiscount) {
    html += `
      <div class="ev-breakdown__row ev-breakdown__discount">
        <span class="ev-breakdown__label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          Promo: ${breakdown.promo_code}
        </span>
        <span class="ev-breakdown__value">-${fc(breakdown.promo_discount)}</span>
      </div>`;
  }

  // Row 3: Tax (if organizer has tax enabled)
  if (hasTax) {
    html += `
      <div class="ev-breakdown__row">
        <span class="ev-breakdown__label">
          ${breakdown.tax_label || 'VAT'} (${breakdown.tax_rate}%)
        </span>
        <span class="ev-breakdown__value">${fc(breakdown.tax_amount)}</span>
      </div>`;
  }

  // Row 4: Service fee (platform fee)
  if (hasFee) {
    html += `
      <div class="ev-breakdown__row">
        <span class="ev-breakdown__label">Service Fee</span>
        <span class="ev-breakdown__value">${fc(breakdown.platform_fee_total)}</span>
      </div>`;
  }

  // Divider
  html += `<div class="ev-breakdown__divider"></div>`;

  // Row 5: TOTAL
  html += `
    <div class="ev-breakdown__row ev-breakdown__total">
      <span class="ev-breakdown__label">Total</span>
      <span class="ev-breakdown__value">${fc(breakdown.total)}</span>
    </div>`;

  // Row 6: Organizer net (dashboard only)
  if (showOrganizerNet) {
    html += `
      <div class="ev-breakdown__row ev-breakdown__net">
        <span class="ev-breakdown__label">Your Revenue</span>
        <span class="ev-breakdown__value">${fc(breakdown.organizer_net)}</span>
      </div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

/**
 * CSS styles for the breakdown component.
 * Injected once into the document head on first use.
 */
let stylesInjected = false;
export function injectBreakdownStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'ev-breakdown-styles';
  style.textContent = `
    .ev-breakdown {
      background: var(--ev-card-bg, rgba(255,255,255,0.05));
      border: 1px solid var(--ev-border, rgba(255,255,255,0.1));
      border-radius: 12px;
      padding: 16px 20px;
      font-family: var(--ev-font, 'Inter', system-ui, sans-serif);
      font-size: 14px;
      color: var(--ev-text, #e0e0e0);
      margin: 12px 0;
      backdrop-filter: blur(8px);
    }

    .ev-breakdown[data-compact="true"] {
      padding: 12px 14px;
      font-size: 13px;
    }

    .ev-breakdown__row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
    }

    .ev-breakdown__label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--ev-text-sec, #a0a0a0);
    }

    .ev-breakdown__value {
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      color: var(--ev-text, #e0e0e0);
    }

    .ev-breakdown__discount .ev-breakdown__label {
      color: var(--ev-success, #4ade80);
    }
    .ev-breakdown__discount .ev-breakdown__value {
      color: var(--ev-success, #4ade80);
    }

    .ev-breakdown__divider {
      height: 1px;
      background: var(--ev-border, rgba(255,255,255,0.1));
      margin: 8px 0;
    }

    .ev-breakdown__total .ev-breakdown__label {
      font-weight: 700;
      font-size: 1.05em;
      color: var(--ev-text, #e0e0e0);
    }
    .ev-breakdown__total .ev-breakdown__value {
      font-weight: 700;
      font-size: 1.1em;
      color: var(--ev-accent, #a78bfa);
    }

    .ev-breakdown__net .ev-breakdown__label {
      color: var(--ev-text-sec, #a0a0a0);
      font-size: 0.9em;
    }
    .ev-breakdown__net .ev-breakdown__value {
      color: var(--ev-success, #4ade80);
      font-size: 0.95em;
    }

    /* Loading state */
    .ev-breakdown--loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--ev-text-sec, #a0a0a0);
      gap: 8px;
    }
    .ev-breakdown--loading::before {
      content: '';
      width: 16px;
      height: 16px;
      border: 2px solid var(--ev-border, rgba(255,255,255,0.2));
      border-top-color: var(--ev-accent, #a78bfa);
      border-radius: 50%;
      animation: ev-spin 0.6s linear infinite;
    }
    @keyframes ev-spin {
      to { transform: rotate(360deg); }
    }

    /* Error state */
    .ev-breakdown--error {
      padding: 12px 16px;
      color: var(--ev-error, #f87171);
      font-size: 13px;
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Full flow: Show loading → Fetch breakdown → Render result.
 * Convenience function for common use case.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {string} tierId - Ticket tier UUID
 * @param {number} quantity - Number of tickets
 * @param {string|null} promoCode - Optional promo code
 * @param {Object} [options] - Display options
 * @returns {Promise<Object|null>} The breakdown data, or null on error
 *
 * Usage:
 *   const breakdown = await fetchAndRenderBreakdown(
 *     document.getElementById('price-breakdown'),
 *     tierId, qty, promoCode
 *   );
 */
export async function fetchAndRenderBreakdown(container, tierId, quantity, promoCode = null, options = {}) {
  if (!container) return null;

  // Inject CSS on first call
  injectBreakdownStyles();

  // Show loading spinner
  container.innerHTML = `<div class="ev-breakdown ev-breakdown--loading">Calculating price...</div>`;

  try {
    const breakdown = await getOrderBreakdown(tierId, quantity, promoCode);
    renderPriceBreakdown(container, breakdown, options);
    return breakdown;
  } catch (err) {
    console.error('Breakdown fetch failed:', err);
    const safeMsg = (err.message || 'Failed to load pricing').replace(/[<>&"']/g, c => 
      ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    container.innerHTML = `<div class="ev-breakdown ev-breakdown--error">${safeMsg}</div>`;
    return null;
  }
}
