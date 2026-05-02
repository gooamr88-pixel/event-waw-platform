/* ═══════════════════════════════════
   EVENT WAW — Interactive Seating Chart Engine
   SVG-based renderer with panzoom (3.4KB)
   ═══════════════════════════════════ */

import panzoom from 'https://esm.sh/panzoom@9';
import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';

// ── Tier color palette (up to 8 tiers, cyclical) ──
const TIER_COLORS = [
  '#d4af37', // Gold
  '#8b5cf6', // Purple
  '#3b82f6', // Blue
  '#22c55e', // Green
  '#3B82F6', // Orange
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#ef4444', // Red
];

const STATUS_STYLES = {
  available:  { fill: 'var(--seat-available)',  cursor: 'pointer',   opacity: 1   },
  reserved:   { fill: 'var(--seat-reserved)',   cursor: 'not-allowed', opacity: 0.4 },
  sold:       { fill: 'var(--seat-sold)',       cursor: 'not-allowed', opacity: 0.3 },
  blocked:    { fill: 'var(--seat-blocked)',     cursor: 'not-allowed', opacity: 0.2 },
  selected:   { fill: 'var(--seat-selected)',   cursor: 'pointer',   opacity: 1   },
};

/**
 * SeatingChart — manages the full lifecycle of an interactive venue map.
 *
 * Usage:
 *   const chart = new SeatingChart(containerEl, eventId, { onSelectionChange });
 *   await chart.init();
 *   chart.getSelectedSeats(); // → [{ seat_id, section, row, number, tier_id, price }]
 *   chart.destroy();
 */
export class SeatingChart {
  constructor(containerEl, eventId, options = {}) {
    this.container = containerEl;
    this.eventId = eventId;
    this.onSelectionChange = options.onSelectionChange || (() => {});
    this.maxSelectable = options.maxSelectable || 10;

    // State
    this.layout = null;          // layout_json from venue_maps
    this.seatData = new Map();   // seat_id → { section_key, row_label, seat_number, status, tier_id, tier_name, tier_price }
    this.selectedSeats = new Set();
    this.tierColorMap = new Map(); // tier_id → color
    this.svgEl = null;
    this.panzoomInstance = null;
    this.pollInterval = null;
    this.activeTierId = null;    // filter: only show/select seats for this tier
  }

  /**
   * Initialize: fetch data, render SVG, attach panzoom + events.
   * Returns true if a venue map exists, false if fallback needed.
   */
  async init() {
    // Show loading state
    this._showLoading();

    // 1. Fetch venue map layout
    const { data: mapData, error: mapErr } = await supabase
      .from('venue_maps')
      .select('id, layout_json, version')
      .eq('event_id', this.eventId)
      .maybeSingle();

    if (mapErr || !mapData) {
      this._hideLoading();
      console.log('No venue map found for event — using GA fallback');
      return false;
    }

    this.layout = mapData.layout_json;
    this.mapId = mapData.id;

    // 2. Fetch seat statuses
    await this.refreshSeatData();

    // 3. Render the SVG
    this._hideLoading();
    this._renderSVG();

    // 4. Attach panzoom
    this._initPanzoom();

    // 5. Attach click + touch handlers (event delegation on SVG)
    this._attachEvents();

    // 6. Start polling for live updates (every 15s)
    this.pollInterval = setInterval(() => this._pollUpdates(), 15000);

    return true;
  }

  _showLoading() {
    setSafeHTML(this.container, `
      <div class="seating-chart-loading">
        <div class="seat-loader"></div>
        <span>Loading venue map…</span>
      </div>`);
  }

  _hideLoading() {
    const loader = this.container.querySelector('.seating-chart-loading');
    if (loader) loader.remove();
  }

  /**
   * Fetch/refresh seat data from the get_seat_map RPC.
   */
  async refreshSeatData() {
    const { data, error } = await supabase
      .rpc('get_seat_map', { p_event_id: this.eventId });

    if (error) {
      console.error('Failed to fetch seat map:', error);
      return;
    }

    this.seatData.clear();
    const tierIds = new Set();

    for (const s of (data || [])) {
      this.seatData.set(s.seat_id, {
        section_key: s.section_key,
        row_label: s.row_label,
        seat_number: s.seat_number,
        status: s.status,
        tier_id: s.tier_id,
        tier_name: s.tier_name || '',
        tier_price: s.tier_price || 0,
      });
      if (s.tier_id) tierIds.add(s.tier_id);
    }

    // Build tier → color map
    let i = 0;
    for (const tid of tierIds) {
      if (!this.tierColorMap.has(tid)) {
        this.tierColorMap.set(tid, TIER_COLORS[i % TIER_COLORS.length]);
        i++;
      }
    }
  }

  /**
   * Get the currently selected seats for checkout.
   */
  getSelectedSeats() {
    const seats = [];
    for (const id of this.selectedSeats) {
      const d = this.seatData.get(id);
      if (d) {
        seats.push({
          seat_id: id,
          section_key: d.section_key,
          row_label: d.row_label,
          seat_number: d.seat_number,
          tier_id: d.tier_id,
          tier_name: d.tier_name,
          tier_price: d.tier_price,
        });
      }
    }
    return seats;
  }

  /**
   * Get the tier_id of the currently selected seats (all must be same tier).
   */
  getSelectedTierId() {
    const seats = this.getSelectedSeats();
    if (seats.length === 0) return null;
    return seats[0].tier_id;
  }

  /**
   * Set an active tier filter. Only seats from this tier are selectable.
   * Pass null to clear the filter.
   */
  setActiveTier(tierId) {
    this.activeTierId = tierId;
    // Clear selections from other tiers
    for (const id of [...this.selectedSeats]) {
      const d = this.seatData.get(id);
      if (d && d.tier_id !== tierId) {
        this.selectedSeats.delete(id);
        this._updateSeatVisual(id);
      }
    }
    // Dim non-matching seats
    this._updateAllVisuals();
    this.onSelectionChange(this.getSelectedSeats());
  }

  /**
   * Clear all selections.
   */
  clearSelection() {
    for (const id of [...this.selectedSeats]) {
      this.selectedSeats.delete(id);
      this._updateSeatVisual(id);
    }
    this.onSelectionChange(this.getSelectedSeats());
  }

  /**
   * Clean up: remove panzoom, event listeners, polling.
   */
  destroy() {
    if (this.panzoomInstance) {
      this.panzoomInstance.dispose();
      this.panzoomInstance = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.svgEl) {
      this.svgEl.remove();
      this.svgEl = null;
    }
  }

  // ════════════════════════════════════
  // PRIVATE: SVG Rendering
  // ════════════════════════════════════

  _renderSVG() {
    const layout = this.layout;
    const canvas = layout.canvas || { width: 1200, height: 800 };

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    svg.setAttribute('class', 'seating-chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Interactive venue seating chart');

    // Background
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', canvas.width);
    bg.setAttribute('height', canvas.height);
    bg.setAttribute('fill', 'transparent');
    svg.appendChild(bg);

    // Stage
    if (layout.stage) {
      const st = layout.stage;
      const stageGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      stageGroup.setAttribute('class', 'stage-group');

      const stageRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      stageRect.setAttribute('x', st.x);
      stageRect.setAttribute('y', st.y);
      stageRect.setAttribute('width', st.width);
      stageRect.setAttribute('height', st.height);
      stageRect.setAttribute('rx', '8');
      stageRect.setAttribute('class', 'stage-rect');
      stageGroup.appendChild(stageRect);

      const stageLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      stageLabel.setAttribute('x', st.x + st.width / 2);
      stageLabel.setAttribute('y', st.y + st.height / 2 + 5);
      stageLabel.setAttribute('text-anchor', 'middle');
      stageLabel.setAttribute('class', 'stage-label');
      stageLabel.textContent = st.label || 'STAGE';
      stageGroup.appendChild(stageLabel);

      svg.appendChild(stageGroup);
    }

    // Sections
    for (const section of (layout.sections || [])) {
      const sectionGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      sectionGroup.setAttribute('class', 'section-group');
      sectionGroup.setAttribute('data-section', section.key);

      if (section.transform) {
        // Calculate section center for transform origin
        let cx = 0, cy = 0, count = 0;
        for (const row of (section.rows || [])) {
          for (const seat of (row.seats || [])) {
            cx += seat.x; cy += seat.y; count++;
          }
        }
        if (count > 0) {
          cx /= count; cy /= count;
          sectionGroup.setAttribute('style', `transform-origin: ${cx}px ${cy}px; transform: ${section.transform}`);
        }
      }

      // Section label
      if (section.label && section.labelX !== undefined) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', section.labelX);
        label.setAttribute('y', section.labelY || 0);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'section-label');
        label.textContent = section.label;
        sectionGroup.appendChild(label);
      }

      // Rows
      for (const row of (section.rows || [])) {
        // Row label
        if (row.labelX !== undefined) {
          const rowLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          rowLabel.setAttribute('x', row.labelX);
          rowLabel.setAttribute('y', row.labelY || (row.seats?.[0]?.y || 0) + 4);
          rowLabel.setAttribute('text-anchor', 'middle');
          rowLabel.setAttribute('class', 'row-label');
          rowLabel.textContent = row.label;
          sectionGroup.appendChild(rowLabel);
        }

        // Seats
        for (const seat of (row.seats || [])) {
          // Find this seat's data from the DB
          const seatRecord = this._findSeatRecord(section.key, row.label, seat.number);
          if (!seatRecord) continue;

          const [seatId, seatInfo] = seatRecord;
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', seat.x);
          circle.setAttribute('cy', seat.y);
          circle.setAttribute('r', seat.r || 6);
          circle.setAttribute('data-seat-id', seatId);
          circle.setAttribute('data-section', section.key);
          circle.setAttribute('data-row', row.label);
          circle.setAttribute('data-number', seat.number);
          circle.setAttribute('class', `seat seat-${seatInfo.status}`);

          // Color by tier
          const tierColor = this.tierColorMap.get(seatInfo.tier_id) || '#666';
          circle.setAttribute('data-tier-color', tierColor);

          // Accessible tooltip
          circle.setAttribute('aria-label',
            `${section.label || section.key} Row ${row.label} Seat ${seat.number} — ${seatInfo.tier_name} $${seatInfo.tier_price} — ${seatInfo.status}`
          );

          this._applySeatStyle(circle, seatInfo.status, tierColor);
          sectionGroup.appendChild(circle);
        }
      }

      svg.appendChild(sectionGroup);
    }

    // Mount
    this.container.textContent = '';
    this.container.appendChild(svg);
    this.svgEl = svg;
  }

  _findSeatRecord(sectionKey, rowLabel, seatNumber) {
    for (const [id, d] of this.seatData) {
      if (d.section_key === sectionKey && d.row_label === rowLabel && d.seat_number === String(seatNumber)) {
        return [id, d];
      }
    }
    return null;
  }

  _applySeatStyle(circle, status, tierColor) {
    const isSelected = this.selectedSeats.has(circle.getAttribute('data-seat-id'));
    const effectiveStatus = isSelected ? 'selected' : status;
    const style = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.available;

    if (effectiveStatus === 'available') {
      circle.style.fill = tierColor;
      circle.style.opacity = this.activeTierId && circle.getAttribute('data-tier-color') !== this.tierColorMap.get(this.activeTierId) ? '0.15' : '1';
    } else if (effectiveStatus === 'selected') {
      circle.style.fill = '#ffffff';
      circle.style.opacity = '1';
      circle.style.stroke = tierColor;
      circle.style.strokeWidth = '2.5';
    } else {
      circle.style.fill = style.fill;
      circle.style.opacity = style.opacity;
      circle.style.stroke = 'none';
    }
    circle.style.cursor = style.cursor;
  }

  // ════════════════════════════════════
  // PRIVATE: Panzoom
  // ════════════════════════════════════

  _initPanzoom() {
    if (!this.svgEl) return;

    this.panzoomInstance = panzoom(this.svgEl, {
      maxZoom: 8,
      minZoom: 0.3,
      smoothScroll: false,
      zoomDoubleClickSpeed: 1,
      // Bounds to prevent losing the map
      bounds: true,
      boundsPadding: 0.2,
    });

    // Add zoom controls
    this._renderZoomControls();
  }

  _renderZoomControls() {
    const controls = document.createElement('div');
    controls.className = 'seating-zoom-controls';
    setSafeHTML(controls, `
      <button class="zoom-btn" data-action="in" aria-label="Zoom in">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="zoom-btn" data-action="out" aria-label="Zoom out">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="zoom-btn" data-action="reset" aria-label="Reset zoom">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3.5 3.5v5h5"/><path d="M3.5 8.5A9 9 0 1 1 5 14"/></svg>
      </button>
    `);

    controls.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const rect = this.svgEl.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      if (action === 'in') this.panzoomInstance.smoothZoom(cx, cy, 1.5);
      else if (action === 'out') this.panzoomInstance.smoothZoom(cx, cy, 0.67);
      else if (action === 'reset') { this.panzoomInstance.moveTo(0, 0); this.panzoomInstance?.zoomAbs(0, 0, 1); }
    });

    this.container.appendChild(controls);
  }

  // ════════════════════════════════════
  // PRIVATE: Event Handling
  // ════════════════════════════════════

  _attachEvents() {
    if (!this.svgEl) return;

    // Unified seat interaction handler
    const handleSeatInteraction = (circle) => {
      const seatId = circle.getAttribute('data-seat-id');
      const seatInfo = this.seatData.get(seatId);
      if (!seatInfo) return;

      // Can't select unavailable seats
      if (seatInfo.status !== 'available') return;

      // Tier filter check
      if (this.activeTierId && seatInfo.tier_id !== this.activeTierId) return;

      // Toggle selection
      if (this.selectedSeats.has(seatId)) {
        this.selectedSeats.delete(seatId);
      } else {
        // Check max selectable
        if (this.selectedSeats.size >= this.maxSelectable) {
          return; // silent limit
        }
        // All selected seats must be from the same tier
        if (this.selectedSeats.size > 0) {
          const existingTier = this.seatData.get([...this.selectedSeats][0])?.tier_id;
          if (existingTier && existingTier !== seatInfo.tier_id) {
            this.clearSelection();
          }
        }
        this.selectedSeats.add(seatId);

        // Add selection animation
        circle.classList.add('seat-selected-anim');
        setTimeout(() => circle.classList.remove('seat-selected-anim'), 300);

        // Haptic feedback on mobile
        if (navigator.vibrate) navigator.vibrate(15);
      }

      this._updateSeatVisual(seatId);
      this.onSelectionChange(this.getSelectedSeats());
    };

    // Click handler (desktop)
    this.svgEl.addEventListener('click', (e) => {
      const circle = e.target.closest('circle[data-seat-id]');
      if (!circle) return;
      handleSeatInteraction(circle);
    });

    // Touch handler (mobile) — prevents double-fire with click
    let touchHandled = false;
    this.svgEl.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const circle = el?.closest('circle[data-seat-id]');
      if (!circle) return;

      e.preventDefault();
      touchHandled = true;
      handleSeatInteraction(circle);

      // Show tooltip briefly on touch
      const seatId = circle.getAttribute('data-seat-id');
      const d = this.seatData.get(seatId);
      if (d) {
        this._showTooltip(circle, d);
        clearTimeout(this._touchTooltipTimer);
        this._touchTooltipTimer = setTimeout(() => this._hideTooltip(), 2000);
      }

      setTimeout(() => { touchHandled = false; }, 100);
    }, { passive: false });

    // Hover tooltip (desktop only)
    this.svgEl.addEventListener('mouseover', (e) => {
      if (touchHandled) return;
      const circle = e.target.closest('circle[data-seat-id]');
      if (!circle) return;
      const seatId = circle.getAttribute('data-seat-id');
      const d = this.seatData.get(seatId);
      if (!d) return;
      this._showTooltip(circle, d);
    });

    this.svgEl.addEventListener('mouseout', (e) => {
      const circle = e.target.closest('circle[data-seat-id]');
      if (circle) this._hideTooltip();
    });
  }

  _updateSeatVisual(seatId) {
    const circle = this.svgEl?.querySelector(`circle[data-seat-id="${seatId}"]`);
    if (!circle) return;
    const d = this.seatData.get(seatId);
    if (!d) return;
    const tierColor = this.tierColorMap.get(d.tier_id) || '#666';
    this._applySeatStyle(circle, d.status, tierColor);
  }

  _updateAllVisuals() {
    if (!this.svgEl) return;
    const circles = this.svgEl.querySelectorAll('circle[data-seat-id]');
    for (const c of circles) {
      const seatId = c.getAttribute('data-seat-id');
      const d = this.seatData.get(seatId);
      if (!d) continue;
      const tierColor = this.tierColorMap.get(d.tier_id) || '#666';

      // Dim seats not matching active tier
      if (this.activeTierId && d.tier_id !== this.activeTierId && d.status === 'available') {
        c.style.opacity = '0.15';
        c.style.cursor = 'not-allowed';
      } else {
        this._applySeatStyle(c, d.status, tierColor);
      }
    }
  }

  // ════════════════════════════════════
  // PRIVATE: Tooltip
  // ════════════════════════════════════

  _showTooltip(circle, data) {
    this._hideTooltip();
    const tooltip = document.createElement('div');
    tooltip.className = 'seat-tooltip';
    tooltip.id = 'seat-tooltip';

    const statusLabel = data.status === 'available' ? 'Available' :
                        data.status === 'sold' ? 'Sold' :
                        data.status === 'reserved' ? 'Reserved' : 'Unavailable';

    setSafeHTML(tooltip, `
      <div class="seat-tooltip-title">${data.tier_name || 'General'}</div>
      <div class="seat-tooltip-info">Row ${data.row_label} · Seat ${data.seat_number}</div>
      <div class="seat-tooltip-price">$${Number(data.tier_price).toLocaleString()}</div>
      <div class="seat-tooltip-status seat-tooltip-${data.status}">${statusLabel}</div>
    `);

    // Position relative to container
    const containerRect = this.container.getBoundingClientRect();
    const circleRect = circle.getBoundingClientRect();
    tooltip.style.left = `${circleRect.left - containerRect.left + circleRect.width / 2}px`;
    tooltip.style.top = `${circleRect.top - containerRect.top - 8}px`;

    this.container.appendChild(tooltip);
  }

  _hideTooltip() {
    document.getElementById('seat-tooltip')?.remove();
  }

  // ════════════════════════════════════
  // PRIVATE: Live Polling
  // ════════════════════════════════════

  async _pollUpdates() {
    const oldStatuses = new Map();
    for (const [id, d] of this.seatData) {
      oldStatuses.set(id, d.status);
    }

    await this.refreshSeatData();

    // Update only changed seats
    for (const [id, d] of this.seatData) {
      const old = oldStatuses.get(id);
      if (old !== d.status) {
        // If a selected seat was taken, deselect it
        if (this.selectedSeats.has(id) && d.status !== 'available') {
          this.selectedSeats.delete(id);
        }
        this._updateSeatVisual(id);
      }
    }

    // Notify if selection changed due to stolen seats
    this.onSelectionChange(this.getSelectedSeats());
  }

  // ════════════════════════════════════
  // PUBLIC: Tier Legend Data
  // ════════════════════════════════════

  getTierLegend() {
    const legend = [];
    const seen = new Set();
    for (const [, d] of this.seatData) {
      if (d.tier_id && !seen.has(d.tier_id)) {
        seen.add(d.tier_id);
        legend.push({
          tier_id: d.tier_id,
          tier_name: d.tier_name,
          tier_price: d.tier_price,
          color: this.tierColorMap.get(d.tier_id) || '#666',
          total: [...this.seatData.values()].filter(s => s.tier_id === d.tier_id).length,
          available: [...this.seatData.values()].filter(s => s.tier_id === d.tier_id && s.status === 'available').length,
        });
      }
    }
    return legend.sort((a, b) => b.tier_price - a.tier_price);
  }
}
