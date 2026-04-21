/* ═══════════════════════════════════
   EVENT WAW — Venue Designer Engine V2
   Professional Drag & Drop Canvas Editor
   ═══════════════════════════════════ */

import { supabase } from './supabase.js';

// ── Constants ──
const SEAT_R = 5;
const SEAT_GAP = 14;
const ROW_GAP = 16;

// ── Element Types ──
export const ELEMENT_TYPES = {
  STAGE:     { id: 'stage',     label: 'Stage',       icon: '🎤', color: '#d4af37' },
  SECTION:   { id: 'section',   label: 'Seat Section', icon: '💺', color: '#3b82f6' },
  BAR:       { id: 'bar',       label: 'Bar / Drinks', icon: '🍸', color: '#8b5cf6' },
  VIP:       { id: 'vip',       label: 'VIP Lounge',   icon: '👑', color: '#f59e0b' },
  TABLE:     { id: 'table',     label: 'Table',       icon: '🪑', color: '#22c55e' },
  BARRIER:   { id: 'barrier',   label: 'Barrier',     icon: '🚧', color: '#ef4444' },
  RESTROOM:  { id: 'restroom',  label: 'Restroom',    icon: '🚻', color: '#6b7280' },
  EXIT:      { id: 'exit',      label: 'Exit',        icon: '🚪', color: '#14b8a6' },
  FOOD:      { id: 'food',      label: 'Food Court',  icon: '🍔', color: '#f97316' },
  DJ:        { id: 'dj',        label: 'DJ Booth',    icon: '🎧', color: '#ec4899' },
  MERCH:     { id: 'merch',     label: 'Merchandise', icon: '🛍️', color: '#a855f7' },
  SCREEN:    { id: 'screen',    label: 'Screen',      icon: '📺', color: '#06b6d4' },
  ENTRANCE:  { id: 'entrance',  label: 'Entrance',    icon: '🚶', color: '#10b981' },
  PHOTO:     { id: 'photo',     label: 'Photo Booth', icon: '📸', color: '#e879f9' },
  LABEL:     { id: 'label',     label: 'Text Label',  icon: '🏷️', color: '#94a3b8' },
};

let _idCounter = 0;
function uid() { return 'el-' + (++_idCounter) + '-' + Date.now().toString(36); }

/**
 * Create a new venue element with default props.
 */
export function createElement(typeId, x = 100, y = 100) {
  const type = ELEMENT_TYPES[typeId.toUpperCase()] || ELEMENT_TYPES.LABEL;
  const base = {
    id: uid(), type: type.id, x, y, rotation: 0,
    label: type.label, color: type.color, locked: false,
  };

  switch (type.id) {
    case 'stage':
      return { ...base, w: 400, h: 60, cornerRadius: 8 };
    case 'section':
      return { ...base, w: 250, h: 150, rows: 5, seatsPerRow: 10, curve: 0, tier_id: null };
    case 'bar':
      return { ...base, w: 160, h: 40, cornerRadius: 20 };
    case 'vip':
      return { ...base, w: 180, h: 120, cornerRadius: 12 };
    case 'table':
      return { ...base, w: 50, h: 50, shape: 'circle', seats: 8 };
    case 'barrier':
      return { ...base, w: 200, h: 8, cornerRadius: 4 };
    case 'screen':
      return { ...base, w: 200, h: 20, cornerRadius: 4 };
    default:
      return { ...base, w: 80, h: 80, cornerRadius: 12 };
  }
}

/**
 * Render all elements to an SVG inside a container.
 */
export function renderCanvas(elements, container, state) {
  const cw = state.canvasW || 1200;
  const ch = state.canvasH || 800;

  let svg = container.querySelector('svg.vd-canvas');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'vd-canvas');
    container.innerHTML = '';
    container.appendChild(svg);
  }

  const vx = state.panX || 0;
  const vy = state.panY || 0;
  const vz = state.zoom || 1;
  svg.setAttribute('viewBox', `${-vx/vz} ${-vy/vz} ${cw/vz} ${ch/vz}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  // Grid (dot pattern like Figma)
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <pattern id="vd-grid" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="12" r="0.6" fill="rgba(255,255,255,.07)"/>
      </pattern>
      <filter id="vd-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`;
    svg.appendChild(defs);
  }

  // Clear previous elements (keep defs)
  svg.querySelectorAll(':not(defs)').forEach(n => n.remove());

  // Grid background
  const bg = nsEl('rect');
  bg.setAttribute('width', cw * 3); bg.setAttribute('height', ch * 3);
  bg.setAttribute('x', -cw); bg.setAttribute('y', -ch);
  bg.setAttribute('fill', 'url(#vd-grid)');
  svg.appendChild(bg);

  // Render each element
  for (const el of elements) {
    const g = nsEl('g');
    g.setAttribute('data-id', el.id);
    g.setAttribute('transform', `translate(${el.x},${el.y})${el.rotation ? ` rotate(${el.rotation},${el.w/2},${el.h/2})` : ''}`);
    g.style.cursor = el.locked ? 'not-allowed' : 'grab';

    if (el.type === 'section') {
      renderSection(g, el);
    } else if (el.type === 'table') {
      renderTable(g, el);
    } else {
      renderGenericElement(g, el);
    }

    // Selection highlight
    if (state.selectedId === el.id) {
      const sel = nsEl('rect');
      sel.setAttribute('x', -3); sel.setAttribute('y', -3);
      sel.setAttribute('width', (el.w || 80) + 6); sel.setAttribute('height', (el.h || 80) + 6);
      sel.setAttribute('rx', 4);
      sel.setAttribute('fill', 'none'); sel.setAttribute('stroke', '#d4af37');
      sel.setAttribute('stroke-width', 1.2); sel.setAttribute('stroke-dasharray', '5 3');
      sel.setAttribute('class', 'vd-sel-ring');
      sel.setAttribute('filter', 'url(#vd-glow)');
      g.insertBefore(sel, g.firstChild);

      // Resize handle (bottom-right)
      const rh = nsEl('circle');
      rh.setAttribute('cx', (el.w || 80)); rh.setAttribute('cy', (el.h || 80));
      rh.setAttribute('r', 4);
      rh.setAttribute('fill', '#d4af37'); rh.setAttribute('stroke', '#000'); rh.setAttribute('stroke-width', 1);
      rh.setAttribute('class', 'vd-resize-handle');
      rh.style.cursor = 'nwse-resize';
      g.appendChild(rh);
    }

    svg.appendChild(g);
  }
}

function renderGenericElement(g, el) {
  const r = nsEl('rect');
  r.setAttribute('width', el.w || 80); r.setAttribute('height', el.h || 80);
  r.setAttribute('rx', el.cornerRadius || 8);
  r.setAttribute('fill', el.color + '18'); r.setAttribute('stroke', el.color + '60');
  r.setAttribute('stroke-width', 1.5);
  g.appendChild(r);

  // Icon
  const icon = nsEl('text');
  icon.setAttribute('x', (el.w || 80) / 2); icon.setAttribute('y', (el.h || 80) / 2 - 6);
  icon.setAttribute('text-anchor', 'middle'); icon.setAttribute('dominant-baseline', 'middle');
  icon.setAttribute('font-size', Math.min(el.h || 80, 28));
  icon.textContent = (ELEMENT_TYPES[el.type.toUpperCase()] || {}).icon || '📦';
  g.appendChild(icon);

  // Label
  const lbl = nsEl('text');
  lbl.setAttribute('x', (el.w || 80) / 2); lbl.setAttribute('y', (el.h || 80) / 2 + 14);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle');
  lbl.setAttribute('fill', el.color); lbl.setAttribute('font-size', 9);
  lbl.setAttribute('font-weight', 600); lbl.setAttribute('font-family', 'Inter, sans-serif');
  lbl.textContent = el.label;
  g.appendChild(lbl);
}

function renderSection(g, el) {
  // Background
  const r = nsEl('rect');
  r.setAttribute('width', el.w); r.setAttribute('height', el.h);
  r.setAttribute('rx', 6);
  r.setAttribute('fill', el.color + '0a'); r.setAttribute('stroke', el.color + '30');
  r.setAttribute('stroke-width', 1);
  g.appendChild(r);

  // Section label
  const lbl = nsEl('text');
  lbl.setAttribute('x', el.w / 2); lbl.setAttribute('y', 12);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('font-size', 9);
  lbl.setAttribute('fill', el.color); lbl.setAttribute('font-weight', 700);
  lbl.setAttribute('font-family', 'Inter, sans-serif');
  lbl.textContent = el.label;
  g.appendChild(lbl);

  // Seats grid
  const rows = el.rows || 3;
  const cols = el.seatsPerRow || 8;
  const padX = 15, padY = 22;
  const areaW = el.w - padX * 2;
  const areaH = el.h - padY - 10;
  const gapX = Math.min(SEAT_GAP, areaW / cols);
  const gapY = Math.min(ROW_GAP, areaH / rows);
  const startX = padX + (areaW - (cols - 1) * gapX) / 2;
  const startY = padY;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sx = startX + col * gapX;
      let sy = startY + row * gapY;

      if (el.curve > 0) {
        const cx = el.w / 2;
        const dx = sx - cx;
        const curveAmt = (el.curve / 500) * (el.h * 0.3);
        sy += curveAmt * (1 - Math.cos((dx / (el.w / 2)) * Math.PI));
      }

      const c = nsEl('circle');
      c.setAttribute('cx', sx); c.setAttribute('cy', sy);
      c.setAttribute('r', Math.min(SEAT_R, gapX / 3));
      c.setAttribute('fill', el.color); c.setAttribute('opacity', 0.7);
      g.appendChild(c);
    }
  }
}

function renderTable(g, el) {
  const cx = (el.w || 50) / 2, cy = (el.h || 50) / 2;
  const tr = Math.min(cx, cy) * 0.45;

  // Table circle
  const tc = nsEl('circle');
  tc.setAttribute('cx', cx); tc.setAttribute('cy', cy); tc.setAttribute('r', tr);
  tc.setAttribute('fill', el.color + '20'); tc.setAttribute('stroke', el.color + '60');
  tc.setAttribute('stroke-width', 1.5);
  g.appendChild(tc);

  // Seats around
  const n = el.seats || 6;
  const sr = tr + 10;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI / n) * i - Math.PI / 2;
    const sc = nsEl('circle');
    sc.setAttribute('cx', cx + sr * Math.cos(angle));
    sc.setAttribute('cy', cy + sr * Math.sin(angle));
    sc.setAttribute('r', 4);
    sc.setAttribute('fill', el.color); sc.setAttribute('opacity', 0.7);
    g.appendChild(sc);
  }

  // Label
  const lbl = nsEl('text');
  lbl.setAttribute('x', cx); lbl.setAttribute('y', cy + 2);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle');
  lbl.setAttribute('fill', el.color); lbl.setAttribute('font-size', 8);
  lbl.setAttribute('font-weight', 700); lbl.setAttribute('font-family', 'Inter, sans-serif');
  lbl.textContent = el.label;
  g.appendChild(lbl);
}

function nsEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

// ═══════════════════════════════
// DRAG & DROP ENGINE
// ═══════════════════════════════

export class VenueDesignerEngine {
  constructor(container, opts = {}) {
    this.container = container;
    this.elements = [];
    this.state = { selectedId: null, zoom: 1, panX: 0, panY: 0, canvasW: 1200, canvasH: 800 };
    this.tiers = opts.tiers || [];
    this.onChange = opts.onChange || (() => {});
    this._dragging = null;
    this._resizing = null;
    this._panning = false;
    this._panStart = null;
    this._lastMouse = null;
    this._undoStack = [];
    this._redoStack = [];
    this._bindEvents();
    this.render();
  }

  // ── Public API ──

  addElement(typeId, x, y) {
    this._pushUndo();
    const el = createElement(typeId, x ?? this.state.canvasW / 2 - 50, y ?? this.state.canvasH / 2 - 30);
    this.elements.push(el);
    this.state.selectedId = el.id;
    this.render();
    this.onChange('add', el);
    return el;
  }

  removeSelected() {
    if (!this.state.selectedId) return;
    this._pushUndo();
    this.elements = this.elements.filter(e => e.id !== this.state.selectedId);
    this.state.selectedId = null;
    this.render();
    this.onChange('remove');
  }

  duplicateSelected() {
    const sel = this.getSelected();
    if (!sel) return;
    this._pushUndo();
    const copy = { ...sel, id: uid(), x: sel.x + 30, y: sel.y + 30 };
    this.elements.push(copy);
    this.state.selectedId = copy.id;
    this.render();
    this.onChange('duplicate', copy);
  }

  getSelected() {
    return this.elements.find(e => e.id === this.state.selectedId) || null;
  }

  updateSelected(props) {
    const el = this.getSelected();
    if (!el) return;
    Object.assign(el, props);
    this.render();
    this.onChange('update', el);
  }

  bringToFront() {
    const el = this.getSelected();
    if (!el) return;
    this.elements = this.elements.filter(e => e.id !== el.id);
    this.elements.push(el);
    this.render();
  }

  sendToBack() {
    const el = this.getSelected();
    if (!el) return;
    this.elements = this.elements.filter(e => e.id !== el.id);
    this.elements.unshift(el);
    this.render();
  }

  toggleLock() {
    const el = this.getSelected();
    if (!el) return;
    el.locked = !el.locked;
    this.render();
    this.onChange('lock', el);
  }

  undo() {
    if (!this._undoStack.length) return;
    this._redoStack.push(JSON.stringify(this.elements));
    this.elements = JSON.parse(this._undoStack.pop());
    this.state.selectedId = null;
    this.render();
    this.onChange('undo');
  }

  redo() {
    if (!this._redoStack.length) return;
    this._undoStack.push(JSON.stringify(this.elements));
    this.elements = JSON.parse(this._redoStack.pop());
    this.state.selectedId = null;
    this.render();
    this.onChange('redo');
  }

  zoomIn()  { this.state.zoom = Math.min(3, this.state.zoom * 1.2); this.render(); }
  zoomOut() { this.state.zoom = Math.max(0.3, this.state.zoom / 1.2); this.render(); }
  resetView() { this.state.zoom = 1; this.state.panX = 0; this.state.panY = 0; this.render(); }

  render() { renderCanvas(this.elements, this.container, this.state); }

  // ── Export for saving ──

  toLayoutJSON() {
    return {
      version: 2,
      canvas: { width: this.state.canvasW, height: this.state.canvasH },
      elements: this.elements.map(e => ({ ...e })),
      // Legacy compat: extract stage + sections for seat creation
      stage: this.elements.find(e => e.type === 'stage') || null,
      sections: this.elements.filter(e => e.type === 'section').map(sec => {
        const rows = [];
        const rowCount = sec.rows || 3;
        const cols = sec.seatsPerRow || 8;
        for (let r = 0; r < rowCount; r++) {
          const seats = [];
          for (let s = 0; s < cols; s++) {
            seats.push({ number: String(s + 1), x: sec.x + s * SEAT_GAP, y: sec.y + r * ROW_GAP, r: SEAT_R });
          }
          rows.push({ label: String.fromCharCode(65 + r), seats });
        }
        return { key: sec.label.toLowerCase().replace(/\s+/g, '-'), label: sec.label, tier_id: sec.tier_id, rows };
      }),
    };
  }

  loadFromJSON(json) {
    if (json.version === 2 && json.elements) {
      this.elements = json.elements;
      _idCounter = Math.max(_idCounter, this.elements.length + 10);
    } else {
      // Legacy v1: convert
      this.elements = [];
      if (json.stage) {
        this.elements.push({
          id: uid(), type: 'stage', x: json.stage.x || 350, y: json.stage.y || 40,
          w: json.stage.width || 400, h: json.stage.height || 60, label: json.stage.label || 'STAGE',
          color: '#d4af37', cornerRadius: 8, rotation: 0, locked: false,
        });
      }
      for (const sec of (json.sections || [])) {
        const rowCount = sec.rows?.length || 5;
        const seatsPerRow = sec.rows?.[0]?.seats?.length || 10;
        this.elements.push({
          id: uid(), type: 'section',
          x: (sec.labelX || 600) - 125, y: (sec.labelY || 200) - 10,
          w: 250, h: Math.max(100, rowCount * ROW_GAP + 40),
          rows: rowCount, seatsPerRow, curve: 0, tier_id: sec.tier_id || null,
          label: sec.label || sec.key, color: '#3b82f6', rotation: 0, locked: false,
        });
      }
    }
    this.state.selectedId = null;
    this.render();
  }

  // ── Private ──

  _pushUndo() {
    this._undoStack.push(JSON.stringify(this.elements));
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack = [];
  }

  _svgPoint(e) {
    const svg = this.container.querySelector('svg');
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgP = pt.matrixTransform(ctm.inverse());
    return { x: svgP.x, y: svgP.y };
  }

  _bindEvents() {
    const c = this.container;

    c.addEventListener('mousedown', (e) => {
      const resizeHandle = e.target.closest('.vd-resize-handle');
      if (resizeHandle) {
        const g = resizeHandle.closest('g[data-id]');
        if (g) {
          const el = this.elements.find(el => el.id === g.dataset.id);
          if (el && !el.locked) {
            this._pushUndo();
            this._resizing = { el, startX: e.clientX, startY: e.clientY, origW: el.w, origH: el.h };
            e.preventDefault(); e.stopPropagation(); return;
          }
        }
      }

      const g = e.target.closest('g[data-id]');
      if (g) {
        const el = this.elements.find(el => el.id === g.dataset.id);
        if (el) {
          this.state.selectedId = el.id;
          if (!el.locked) {
            this._pushUndo();
            const p = this._svgPoint(e);
            this._dragging = { el, offsetX: p.x - el.x, offsetY: p.y - el.y };
          }
          this.render();
          this.onChange('select', el);
          e.preventDefault(); return;
        }
      }

      // Pan
      if (e.button === 0 && !g) {
        this._panning = true;
        this._panStart = { x: e.clientX - this.state.panX, y: e.clientY - this.state.panY };
        c.style.cursor = 'grabbing';
      }

      // Deselect
      if (!g && this.state.selectedId) {
        this.state.selectedId = null;
        this.render();
        this.onChange('deselect');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        const p = this._svgPoint(e);
        this._dragging.el.x = Math.round(p.x - this._dragging.offsetX);
        this._dragging.el.y = Math.round(p.y - this._dragging.offsetY);
        this.render();
      }
      if (this._resizing) {
        const dx = e.clientX - this._resizing.startX;
        const dy = e.clientY - this._resizing.startY;
        const s = 1 / this.state.zoom;
        this._resizing.el.w = Math.max(40, Math.round(this._resizing.origW + dx * s));
        this._resizing.el.h = Math.max(30, Math.round(this._resizing.origH + dy * s));
        this.render();
      }
      if (this._panning) {
        this.state.panX = e.clientX - this._panStart.x;
        this.state.panY = e.clientY - this._panStart.y;
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this._dragging) { this.onChange('move', this._dragging.el); }
      this._dragging = null;
      this._resizing = null;
      if (this._panning) { this._panning = false; c.style.cursor = ''; }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) this.zoomIn();
      else this.zoomOut();
    }, { passive: false });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { this.removeSelected(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'z') { this.undo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'y') { this.redo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'd') { this.duplicateSelected(); e.preventDefault(); }
    });

    // Drop from toolbox
    c.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    c.addEventListener('drop', (e) => {
      e.preventDefault();
      const typeId = e.dataTransfer.getData('text/plain');
      if (typeId && ELEMENT_TYPES[typeId.toUpperCase()]) {
        const p = this._svgPoint(e);
        this.addElement(typeId, p.x - 40, p.y - 25);
      }
    });
  }
}

// ═══════════════════════════════
// SAVE / LOAD (reuses existing DB)
// ═══════════════════════════════

export async function saveVenueMapV2(eventId, engine, sectionTiers = {}) {
  const layoutJson = engine.toLayoutJSON();

  const { data: existingMap } = await supabase
    .from('venue_maps').select('id, version').eq('event_id', eventId).maybeSingle();

  let mapId, version = 1;

  if (existingMap) {
    version = (existingMap.version || 1) + 1;
    const { error } = await supabase.from('venue_maps')
      .update({ layout_json: layoutJson, version }).eq('id', existingMap.id);
    if (error) throw new Error(`Failed to update venue map: ${error.message}`);
    mapId = existingMap.id;
    await supabase.from('seats').delete().eq('venue_map_id', mapId);
  } else {
    const { data, error } = await supabase.from('venue_maps')
      .insert({ event_id: eventId, layout_json: layoutJson, version: 1 }).select('id').single();
    if (error) throw new Error(`Failed to create venue map: ${error.message}`);
    mapId = data.id;
  }

  // Bulk-insert seats from sections
  const seatRows = [];
  for (const section of layoutJson.sections) {
    const tierId = sectionTiers[section.key] || section.tier_id || null;
    for (const row of section.rows) {
      for (const seat of row.seats) {
        seatRows.push({
          venue_map_id: mapId, section_key: section.key,
          row_label: row.label, seat_number: seat.number,
          ticket_tier_id: tierId, status: 'available',
        });
      }
    }
  }

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < seatRows.length; i += BATCH) {
    const batch = seatRows.slice(i, i + BATCH);
    const { error } = await supabase.from('seats').insert(batch);
    if (error) throw new Error(`Seat insert failed: ${error.message}`);
    inserted += batch.length;
  }

  return { mapId, seatCount: inserted, version };
}
