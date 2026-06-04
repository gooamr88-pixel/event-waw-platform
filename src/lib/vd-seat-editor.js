/* ===================================
   EVENTSLI - Venue Designer Seat Editor
   v62: Per-seat & per-row property editing
   ===================================
   Provides a full-screen overlay for editing individual
   seats within a section. Supports:
   - Multi-select (click, shift+click, row select)
   - Bulk property editing (tier, price, category, status, promo, notes)
   - Custom row naming
   - Visual indicators (category colors, blocked icons, price tags)
   =================================== */

import { SEAT_R, SEAT_GAP, ROW_GAP } from './vd-engine.js';
import { escapeHTML } from './utils.js';

// ── Category definitions ──
export const SEAT_CATEGORIES = {
  standard:        { label: 'Standard',        color: '#10B981', icon: '' },
  vip:             { label: 'VIP',             color: '#f59e0b', icon: '⭐' },
  premium:         { label: 'Premium',         color: '#8b5cf6', icon: '💎' },
  accessible:      { label: 'Accessible',      color: '#3b82f6', icon: '♿' },
  restricted_view: { label: 'Restricted View', color: '#ef4444', icon: '👁️' },
  companion:       { label: 'Companion',       color: '#06b6d4', icon: '🤝' },
};

/**
 * Open the seat editor overlay for a given section element.
 * @param {object} engine - VenueDesignerEngine instance
 * @param {object} sectionEl - The section element from engine.elements
 * @param {Array} tiers - Array of { id, name, price, currency } tier objects
 * @param {Function} onClose - Callback when editor is closed
 */
export function openSeatEditor(engine, sectionEl, tiers, onClose) {
  if (!sectionEl || sectionEl.type !== 'section') return;

  // State
  let selectedSeats = new Set(); // Set of 'rowLabel::seatNumber' keys
  const overrides = sectionEl.seatOverrides || {};
  const customRowNames = sectionEl.customRowNames || {};
  const rows = sectionEl.rows || 3;
  const cols = sectionEl.seatsPerRow || 8;

  // Build seat grid data
  const seatGrid = [];
  for (let r = 0; r < rows; r++) {
    const rowLabel = _rowLabel(r);
    const rowSeats = [];
    for (let s = 1; s <= cols; s++) {
      const key = `${rowLabel}::${s}`;
      const ovr = overrides[key] || {};
      rowSeats.push({
        key,
        row: rowLabel,
        number: s,
        category: ovr.category || 'standard',
        price_override: ovr.price_override ?? null,
        tier_id: ovr.tier_id || null,
        status: ovr.status || 'available',
        promo_lock: ovr.promo_lock || null,
        notes: ovr.notes || null,
      });
    }
    seatGrid.push({ label: rowLabel, customName: customRowNames[rowLabel] || '', seats: rowSeats });
  }

  // ── Create overlay ──
  const overlay = document.createElement('div');
  overlay.className = 'vd-seat-editor-overlay';
  overlay.innerHTML = `
    <div class="vd-seat-editor">
      <div class="vd-se-header">
        <div class="vd-se-header-left">
          <button class="vd-se-back" id="se-back" title="Back to section">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
            </svg>
          </button>
          <div>
            <h3 class="vd-se-title">💺 Seat Editor — <span>${escapeHTML(sectionEl.label)}</span></h3>
            <p class="vd-se-subtitle">${rows} rows × ${cols} seats · Click seats to select · Shift+click for range</p>
          </div>
        </div>
        <div class="vd-se-header-right">
          <span class="vd-se-sel-count" id="se-sel-count">0 selected</span>
          <button class="vd-se-btn-clear" id="se-clear-sel" title="Clear Selection">Clear</button>
          <button class="vd-se-btn-all" id="se-select-all" title="Select All">Select All</button>
        </div>
      </div>

      <div class="vd-se-body">
        <div class="vd-se-canvas-area" id="se-canvas-area">
          <div class="vd-se-grid" id="se-grid"></div>
        </div>

        <div class="vd-se-props" id="se-props-panel">
          <div class="vd-se-props-empty" id="se-props-empty">
            <div class="vd-se-props-empty-icon">💺</div>
            <p>Select seats to edit<br/>their properties</p>
          </div>
          <div class="vd-se-props-form" id="se-props-form" style="display:none;">
            <div class="vd-se-props-header" id="se-props-header"></div>

            <div class="vd-se-field">
              <label>Category</label>
              <select class="vd-fi" id="se-prop-category">
                ${Object.entries(SEAT_CATEGORIES).map(([k, v]) =>
                  `<option value="${k}">${v.icon} ${v.label}</option>`
                ).join('')}
              </select>
            </div>

            <div class="vd-se-field">
              <label>Tier Override</label>
              <select class="vd-fi" id="se-prop-tier">
                <option value="">— Inherit Section Tier —</option>
                ${tiers.map(t =>
                  `<option value="${t.id}">${escapeHTML(t.name)} — ${Number(t.price).toLocaleString()} ${t.currency || ''}</option>`
                ).join('')}
              </select>
            </div>

            <div class="vd-se-field">
              <label>Price Override</label>
              <div class="vd-se-field-row">
                <input type="number" class="vd-fi" id="se-prop-price" placeholder="Leave blank to use tier price" step="0.01" min="0" />
                <button class="vd-se-btn-mini" id="se-clear-price" title="Clear price override">✕</button>
              </div>
            </div>

            <div class="vd-se-field">
              <label>Status</label>
              <select class="vd-fi" id="se-prop-status">
                <option value="available">✅ Available</option>
                <option value="blocked">🚫 Blocked</option>
              </select>
            </div>

            <div class="vd-se-field">
              <label>Promo Lock</label>
              <input type="text" class="vd-fi" id="se-prop-promo" placeholder="e.g. VIP2026 (blank = no lock)" />
            </div>

            <div class="vd-se-field">
              <label>Notes</label>
              <textarea class="vd-fi" id="se-prop-notes" rows="2" placeholder="Admin notes..."></textarea>
            </div>

            <div class="vd-se-props-actions">
              <button class="vd-se-btn-apply" id="se-apply">Apply to Selected</button>
            </div>
          </div>
        </div>
      </div>

      <div class="vd-se-footer">
        <div class="vd-se-row-names" id="se-row-names-panel"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // ── Render the seat grid ──
  function renderGrid() {
    const grid = document.getElementById('se-grid');
    if (!grid) return;

    let html = '';
    for (const row of seatGrid) {
      const rowLabel = row.label;
      const displayName = row.customName || rowLabel;

      html += `<div class="vd-se-row">`;
      html += `<div class="vd-se-row-label" data-row="${rowLabel}" title="Click to select entire row">${escapeHTML(displayName)}</div>`;

      for (const seat of row.seats) {
        const cat = SEAT_CATEGORIES[seat.category] || SEAT_CATEGORIES.standard;
        const isSelected = selectedSeats.has(seat.key);
        const isBlocked = seat.status === 'blocked';
        const hasOverride = seat.price_override != null || seat.tier_id || seat.promo_lock;

        let cls = 'vd-se-seat';
        if (isSelected) cls += ' selected';
        if (isBlocked) cls += ' blocked';
        if (hasOverride) cls += ' has-override';

        const bgColor = cat.color;
        const icon = isBlocked ? '✕' : (cat.icon || '');
        const priceTag = seat.price_override != null ? `$${seat.price_override}` : '';

        html += `<div class="${cls}" data-key="${seat.key}" data-row="${rowLabel}" 
                      style="--seat-color: ${bgColor};" 
                      title="${escapeHTML(displayName)} Seat ${seat.number}${priceTag ? ' · ' + priceTag : ''}${seat.notes ? ' · ' + seat.notes : ''}">
          <span class="vd-se-seat-num">${seat.number}</span>
          ${icon ? `<span class="vd-se-seat-icon">${icon}</span>` : ''}
          ${priceTag ? `<span class="vd-se-seat-price">${priceTag}</span>` : ''}
        </div>`;
      }
      html += `</div>`;
    }

    grid.innerHTML = html;

    // Render row names panel
    renderRowNames();
  }

  function renderRowNames() {
    const panel = document.getElementById('se-row-names-panel');
    if (!panel) return;
    let html = '<div class="vd-se-rn-title">📝 Custom Row Names</div><div class="vd-se-rn-grid">';
    for (const row of seatGrid) {
      html += `<div class="vd-se-rn-item">
        <span class="vd-se-rn-label">${row.label}</span>
        <input type="text" class="vd-fi vd-se-rn-input" data-row="${row.label}" 
               value="${escapeHTML(row.customName)}" placeholder="${row.label}" />
      </div>`;
    }
    html += '</div>';
    panel.innerHTML = html;

    // Bind row name inputs
    panel.querySelectorAll('.vd-se-rn-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const rowLabel = inp.dataset.row;
        const val = inp.value.trim();
        engine.setCustomRowName(sectionEl.id, rowLabel, val);
        // Update local state
        const row = seatGrid.find(r => r.label === rowLabel);
        if (row) row.customName = val;
        renderGrid();
      });
    });
  }

  function updateSelectionCount() {
    const count = selectedSeats.size;
    document.getElementById('se-sel-count').textContent = `${count} selected`;
    document.getElementById('se-props-empty').style.display = count > 0 ? 'none' : '';
    document.getElementById('se-props-form').style.display = count > 0 ? '' : 'none';

    if (count > 0) {
      // Populate props from first selected seat
      const firstKey = [...selectedSeats][0];
      const seat = _findSeat(firstKey);
      if (seat) {
        document.getElementById('se-prop-category').value = seat.category || 'standard';
        document.getElementById('se-prop-tier').value = seat.tier_id || '';
        document.getElementById('se-prop-price').value = seat.price_override ?? '';
        document.getElementById('se-prop-status').value = seat.status || 'available';
        document.getElementById('se-prop-promo').value = seat.promo_lock || '';
        document.getElementById('se-prop-notes').value = seat.notes || '';
      }

      // Props header
      const header = document.getElementById('se-props-header');
      if (count === 1) {
        const s = _findSeat(firstKey);
        header.innerHTML = `<div class="vd-se-ph-single">
          <span class="vd-se-ph-badge">${s.row} · ${s.number}</span>
          <span class="vd-se-ph-cat" style="color:${(SEAT_CATEGORIES[s.category] || SEAT_CATEGORIES.standard).color}">
            ${(SEAT_CATEGORIES[s.category] || SEAT_CATEGORIES.standard).label}
          </span>
        </div>`;
      } else {
        header.innerHTML = `<div class="vd-se-ph-multi">${count} seats selected</div>`;
      }
    }
  }

  function _findSeat(key) {
    for (const row of seatGrid) {
      for (const seat of row.seats) {
        if (seat.key === key) return seat;
      }
    }
    return null;
  }

  // ── Event handlers ──
  let lastClickedKey = null;

  // Seat click handler
  document.getElementById('se-grid').addEventListener('click', (e) => {
    const seatEl = e.target.closest('.vd-se-seat');
    const rowLabelEl = e.target.closest('.vd-se-row-label');

    if (rowLabelEl) {
      // Select entire row
      const rowLabel = rowLabelEl.dataset.row;
      const row = seatGrid.find(r => r.label === rowLabel);
      if (row) {
        const allSelected = row.seats.every(s => selectedSeats.has(s.key));
        if (allSelected) {
          row.seats.forEach(s => selectedSeats.delete(s.key));
        } else {
          row.seats.forEach(s => selectedSeats.add(s.key));
        }
        renderGrid();
        updateSelectionCount();
      }
      return;
    }

    if (!seatEl) return;
    const key = seatEl.dataset.key;

    if (e.shiftKey && lastClickedKey) {
      // Range select
      const allKeys = seatGrid.flatMap(r => r.seats.map(s => s.key));
      const startIdx = allKeys.indexOf(lastClickedKey);
      const endIdx = allKeys.indexOf(key);
      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        for (let i = from; i <= to; i++) {
          selectedSeats.add(allKeys[i]);
        }
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle individual
      if (selectedSeats.has(key)) selectedSeats.delete(key);
      else selectedSeats.add(key);
    } else {
      // Single select
      selectedSeats.clear();
      selectedSeats.add(key);
    }

    lastClickedKey = key;
    renderGrid();
    updateSelectionCount();
  });

  // Clear selection
  document.getElementById('se-clear-sel').addEventListener('click', () => {
    selectedSeats.clear();
    renderGrid();
    updateSelectionCount();
  });

  // Select all
  document.getElementById('se-select-all').addEventListener('click', () => {
    seatGrid.forEach(r => r.seats.forEach(s => selectedSeats.add(s.key)));
    renderGrid();
    updateSelectionCount();
  });

  // Clear price override
  document.getElementById('se-clear-price').addEventListener('click', () => {
    document.getElementById('se-prop-price').value = '';
  });

  // Apply properties to selected seats
  document.getElementById('se-apply').addEventListener('click', () => {
    if (selectedSeats.size === 0) return;

    const category = document.getElementById('se-prop-category').value;
    const tierId = document.getElementById('se-prop-tier').value || null;
    const priceStr = document.getElementById('se-prop-price').value;
    const priceOverride = priceStr !== '' ? parseFloat(priceStr) : null;
    const status = document.getElementById('se-prop-status').value;
    const promoLock = document.getElementById('se-prop-promo').value.trim() || null;
    const notes = document.getElementById('se-prop-notes').value.trim() || null;

    const props = {
      category,
      tier_id: tierId,
      price_override: priceOverride,
      status,
      promo_lock: promoLock,
      notes,
    };

    // Apply to engine
    engine.setSeatOverrides(sectionEl.id, [...selectedSeats], props);

    // Update local grid state
    for (const key of selectedSeats) {
      const seat = _findSeat(key);
      if (seat) {
        seat.category = category;
        seat.tier_id = tierId;
        seat.price_override = priceOverride;
        seat.status = status;
        seat.promo_lock = promoLock;
        seat.notes = notes;
      }
    }

    renderGrid();
    updateSelectionCount();

    // Show confirmation
    _showToast(`✅ Applied to ${selectedSeats.size} seat${selectedSeats.size > 1 ? 's' : ''}`);
  });

  // Close handler
  function close() {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
    if (onClose) onClose();
  }

  document.getElementById('se-back').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  });

  // Toast helper
  function _showToast(msg) {
    const existing = overlay.querySelector('.vd-se-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'vd-se-toast';
    toast.textContent = msg;
    overlay.querySelector('.vd-seat-editor').appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // Initial render
  renderGrid();
  updateSelectionCount();
}

/** Generate row label: 0→A, 25→Z, 26→AA, etc. */
function _rowLabel(index) {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}
