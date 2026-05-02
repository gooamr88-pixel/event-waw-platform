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
  FOOD:      { id: 'food',      label: 'Food Court',  icon: '🍔', color: '#3B82F6' },
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
    container.textContent = '';
    container.appendChild(svg);
  }

  const vx = state.panX || 0;
  const vy = state.panY || 0;
  const vz = state.zoom || 1;
  svg.setAttribute('viewBox', `${-vx/vz} ${-vy/vz} ${cw/vz} ${ch/vz}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  // Grid + realistic defs
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.insertAdjacentHTML('beforeend', `
      <pattern id="vd-grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,.025)" stroke-width="0.5"/>
      </pattern>
      <pattern id="vd-grid-sm" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,.012)" stroke-width="0.3"/>
      </pattern>
      <filter id="vd-glow"><feGaussianBlur stdDeviation="3" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="vd-glow-lg"><feGaussianBlur stdDeviation="6" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="vd-shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,.5)"/></filter>
      <filter id="vd-inner-shadow"><feOffset dx="0" dy="1"/><feGaussianBlur stdDeviation="1.5"/><feComposite operator="out" in="SourceGraphic"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .25 0"/><feBlend in="SourceGraphic" mode="normal"/></filter>
      <linearGradient id="vd-stage-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4af37"/><stop offset=".5" stop-color="#b8962e"/><stop offset="1" stop-color="#8b711e"/></linearGradient>
      <linearGradient id="vd-curtain-l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b1a1a"/><stop offset=".3" stop-color="#a52222"/><stop offset=".5" stop-color="#6b1414"/><stop offset=".7" stop-color="#a52222"/><stop offset="1" stop-color="#8b1a1a"/></linearGradient>
      <linearGradient id="vd-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5c3d2e"/><stop offset=".5" stop-color="#6d4c3d"/><stop offset="1" stop-color="#4a3020"/></linearGradient>
      <linearGradient id="vd-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#888"/><stop offset=".5" stop-color="#666"/><stop offset="1" stop-color="#444"/></linearGradient>
      <radialGradient id="vd-spot"><stop offset="0" stop-color="rgba(212,175,55,.12)"/><stop offset="1" stop-color="transparent"/></radialGradient>`);
    svg.appendChild(defs);
  }

  // Clear previous elements (keep defs)
  svg.querySelectorAll(':not(defs)').forEach(n => n.remove());

  // Grid background
  const bg = nsEl('rect');
  bg.setAttribute('width', cw * 3); bg.setAttribute('height', ch * 3);
  bg.setAttribute('x', -cw); bg.setAttribute('y', -ch);
  bg.setAttribute('fill', 'url(#vd-grid-sm)');
  svg.appendChild(bg);
  const bg2 = nsEl('rect');
  bg2.setAttribute('width', cw * 3); bg2.setAttribute('height', ch * 3);
  bg2.setAttribute('x', -cw); bg2.setAttribute('y', -ch);
  bg2.setAttribute('fill', 'url(#vd-grid)');
  svg.appendChild(bg2);

  // Spotlight ambiance
  const spot = nsEl('ellipse');
  spot.setAttribute('cx', cw / 2); spot.setAttribute('cy', ch * .35);
  spot.setAttribute('rx', cw * .4); spot.setAttribute('ry', ch * .3);
  spot.setAttribute('fill', 'url(#vd-spot)');
  svg.appendChild(spot);

  // Render each element
  for (const el of elements) {
    const g = nsEl('g');
    g.setAttribute('data-id', el.id);
    g.setAttribute('transform', `translate(${el.x},${el.y})${el.rotation ? ` rotate(${el.rotation},${el.w/2},${el.h/2})` : ''}`);
    g.style.cursor = el.locked ? 'not-allowed' : 'grab';

    if (el.type === 'stage') {
      renderStage(g, el);
    } else if (el.type === 'section') {
      renderSection(g, el);
    } else if (el.type === 'table') {
      renderTable(g, el);
    } else if (el.type === 'barrier') {
      renderBarrier(g, el);
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
      sel.setAttribute('stroke-width', 1.5); sel.setAttribute('stroke-dasharray', '4 3');
      sel.setAttribute('class', 'vd-sel-ring');
      g.insertBefore(sel, g.firstChild);

      // Resize handle
      const rh = nsEl('rect');
      rh.setAttribute('x', (el.w || 80) - 4); rh.setAttribute('y', (el.h || 80) - 4);
      rh.setAttribute('width', 8); rh.setAttribute('height', 8);
      rh.setAttribute('rx', 2);
      rh.setAttribute('fill', '#d4af37'); rh.setAttribute('class', 'vd-resize-handle');
      rh.style.cursor = 'nwse-resize';
      g.appendChild(rh);
    }

    svg.appendChild(g);
  }
}

function renderStage(g, el) {
  const w = el.w || 400, h = el.h || 60;
  // Stage floor (wood)
  const floor = nsEl('rect');
  floor.setAttribute('width', w); floor.setAttribute('height', h);
  floor.setAttribute('rx', 4); floor.setAttribute('fill', 'url(#vd-wood)');
  floor.setAttribute('stroke', '#3a2518'); floor.setAttribute('stroke-width', 1.5);
  floor.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(floor);
  // Wood plank lines
  for (let i = 1; i < 6; i++) {
    const ln = nsEl('line');
    ln.setAttribute('x1', w * i / 6); ln.setAttribute('y1', 0);
    ln.setAttribute('x2', w * i / 6); ln.setAttribute('y2', h);
    ln.setAttribute('stroke', 'rgba(0,0,0,.15)'); ln.setAttribute('stroke-width', .5);
    g.appendChild(ln);
  }
  // Front edge highlight
  const edge = nsEl('rect');
  edge.setAttribute('width', w); edge.setAttribute('height', 3);
  edge.setAttribute('y', h - 3); edge.setAttribute('rx', 1);
  edge.setAttribute('fill', 'url(#vd-stage-g)'); edge.setAttribute('opacity', .8);
  g.appendChild(edge);
  // Left curtain
  const lc = nsEl('rect');
  lc.setAttribute('width', 12); lc.setAttribute('height', h);
  lc.setAttribute('rx', 2); lc.setAttribute('fill', 'url(#vd-curtain-l)');
  lc.setAttribute('opacity', .85);
  g.appendChild(lc);
  // Right curtain
  const rc = nsEl('rect');
  rc.setAttribute('x', w - 12); rc.setAttribute('width', 12); rc.setAttribute('height', h);
  rc.setAttribute('rx', 2); rc.setAttribute('fill', 'url(#vd-curtain-l)');
  rc.setAttribute('opacity', .85);
  g.appendChild(rc);
  // Spotlight glow
  const sp = nsEl('ellipse');
  sp.setAttribute('cx', w / 2); sp.setAttribute('cy', h / 2);
  sp.setAttribute('rx', w * .25); sp.setAttribute('ry', h * .6);
  sp.setAttribute('fill', 'rgba(212,175,55,.08)');
  g.appendChild(sp);
  // Label
  const lbl = nsEl('text');
  lbl.setAttribute('x', w / 2); lbl.setAttribute('y', h / 2 + 1);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle');
  lbl.setAttribute('fill', '#f3e5ab'); lbl.setAttribute('font-size', 11);
  lbl.setAttribute('font-weight', 700); lbl.setAttribute('font-family', 'Inter, sans-serif');
  lbl.setAttribute('letter-spacing', '2');
  lbl.textContent = el.label.toUpperCase();
  g.appendChild(lbl);
}

function renderGenericElement(g, el) {
  const w = el.w || 80, h = el.h || 80;
  const c = el.color;
  // Outer glow
  const glow = nsEl('rect');
  glow.setAttribute('x', -4); glow.setAttribute('y', -4);
  glow.setAttribute('width', w + 8); glow.setAttribute('height', h + 8);
  glow.setAttribute('rx', (el.cornerRadius || 8) + 4);
  glow.setAttribute('fill', c + '08'); glow.setAttribute('stroke', 'none');
  g.appendChild(glow);
  // Main body
  const r = nsEl('rect');
  r.setAttribute('width', w); r.setAttribute('height', h);
  r.setAttribute('rx', el.cornerRadius || 8);
  r.setAttribute('fill', c + '15');
  r.setAttribute('stroke', c + '40'); r.setAttribute('stroke-width', 1);
  r.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(r);
  // Inner highlight
  const hi = nsEl('rect');
  hi.setAttribute('x', 2); hi.setAttribute('y', 2);
  hi.setAttribute('width', w - 4); hi.setAttribute('height', h * .4);
  hi.setAttribute('rx', (el.cornerRadius || 8) - 1);
  hi.setAttribute('fill', 'rgba(255,255,255,.03)');
  g.appendChild(hi);
  // Icon
  const icon = nsEl('text');
  icon.setAttribute('x', w / 2); icon.setAttribute('y', h / 2 - (h > 40 ? 6 : 0));
  icon.setAttribute('text-anchor', 'middle'); icon.setAttribute('dominant-baseline', 'middle');
  icon.setAttribute('font-size', Math.min(h * .35, 24));
  icon.textContent = (ELEMENT_TYPES[el.type.toUpperCase()] || {}).icon || '📦';
  g.appendChild(icon);
  // Label
  if (h > 30) {
    const lbl = nsEl('text');
    lbl.setAttribute('x', w / 2); lbl.setAttribute('y', h / 2 + 14);
    lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle');
    lbl.setAttribute('fill', c); lbl.setAttribute('font-size', 8);
    lbl.setAttribute('font-weight', 600); lbl.setAttribute('font-family', 'Inter, sans-serif');
    lbl.setAttribute('opacity', '.9');
    lbl.textContent = el.label;
    g.appendChild(lbl);
  }
}

function renderBarrier(g, el) {
  const w = el.w || 200, h = el.h || 8;
  // Metal rail
  const rail = nsEl('rect');
  rail.setAttribute('width', w); rail.setAttribute('height', h);
  rail.setAttribute('rx', h / 2); rail.setAttribute('fill', 'url(#vd-metal)');
  rail.setAttribute('stroke', '#555'); rail.setAttribute('stroke-width', .5);
  rail.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(rail);
  // Posts
  for (let i = 0; i <= 1; i++) {
    const p = nsEl('rect');
    p.setAttribute('x', i === 0 ? 0 : w - 4);
    p.setAttribute('y', -6); p.setAttribute('width', 4); p.setAttribute('height', h + 12);
    p.setAttribute('rx', 2); p.setAttribute('fill', '#777');
    p.setAttribute('stroke', '#555'); p.setAttribute('stroke-width', .5);
    g.appendChild(p);
  }
  // Highlight
  const hl = nsEl('rect');
  hl.setAttribute('width', w); hl.setAttribute('height', h * .35);
  hl.setAttribute('rx', h / 2);
  hl.setAttribute('fill', 'rgba(255,255,255,.12)');
  g.appendChild(hl);
}

function renderSection(g, el) {
  const w = el.w, h = el.h;
  // Background with gradient
  const r = nsEl('rect');
  r.setAttribute('width', w); r.setAttribute('height', h);
  r.setAttribute('rx', 8);
  r.setAttribute('fill', el.color + '08');
  r.setAttribute('stroke', el.color + '20'); r.setAttribute('stroke-width', 1);
  r.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(r);
  // Inner highlight top
  const hi = nsEl('rect');
  hi.setAttribute('x', 1); hi.setAttribute('y', 1);
  hi.setAttribute('width', w - 2); hi.setAttribute('height', 18);
  hi.setAttribute('rx', 7);
  hi.setAttribute('fill', el.color + '0a');
  g.appendChild(hi);
  // Section label
  const lbl = nsEl('text');
  lbl.setAttribute('x', w / 2); lbl.setAttribute('y', 13);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('font-size', 9);
  lbl.setAttribute('fill', el.color); lbl.setAttribute('font-weight', 700);
  lbl.setAttribute('font-family', 'Inter, sans-serif');
  lbl.setAttribute('letter-spacing', '.5');
  lbl.textContent = el.label;
  g.appendChild(lbl);

  // Realistic chair seats
  const rows = el.rows || 3, cols = el.seatsPerRow || 8;
  const padX = 15, padY = 24;
  const areaW = w - padX * 2, areaH = h - padY - 10;
  const gapX = Math.min(SEAT_GAP, areaW / cols);
  const gapY = Math.min(ROW_GAP, areaH / rows);
  const startX = padX + (areaW - (cols - 1) * gapX) / 2;
  const startY = padY;
  const sr = Math.min(SEAT_R, gapX / 3);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sx = startX + col * gapX;
      let sy = startY + row * gapY;
      if (el.curve > 0) {
        const cx = w / 2, dx = sx - cx;
        const curveAmt = (el.curve / 500) * (h * 0.3);
        sy += curveAmt * (1 - Math.cos((dx / (w / 2)) * Math.PI));
      }
      // Chair back (small arc)
      const back = nsEl('path');
      const bw = sr * 1.6, bh = sr * .8;
      back.setAttribute('d', `M${sx - bw},${sy - sr * .5} Q${sx},${sy - sr * 1.6} ${sx + bw},${sy - sr * .5}`);
      back.setAttribute('fill', 'none'); back.setAttribute('stroke', el.color);
      back.setAttribute('stroke-width', 1); back.setAttribute('opacity', '.5');
      g.appendChild(back);
      // Seat cushion
      const seat = nsEl('rect');
      seat.setAttribute('x', sx - sr); seat.setAttribute('y', sy - sr * .5);
      seat.setAttribute('width', sr * 2); seat.setAttribute('height', sr * 1.4);
      seat.setAttribute('rx', sr * .4);
      seat.setAttribute('fill', el.color); seat.setAttribute('opacity', '.65');
      g.appendChild(seat);
      // Seat highlight
      const shl = nsEl('rect');
      shl.setAttribute('x', sx - sr + .5); shl.setAttribute('y', sy - sr * .5);
      shl.setAttribute('width', sr * 2 - 1); shl.setAttribute('height', sr * .5);
      shl.setAttribute('rx', sr * .3);
      shl.setAttribute('fill', 'rgba(255,255,255,.15)');
      g.appendChild(shl);
    }
  }
}

function renderTable(g, el) {
  const w = el.w || 50, h = el.h || 50;
  const cx = w / 2, cy = h / 2;
  const tr = Math.min(cx, cy) * 0.45;
  // Table shadow
  const shd = nsEl('ellipse');
  shd.setAttribute('cx', cx + 1); shd.setAttribute('cy', cy + 2);
  shd.setAttribute('rx', tr + 2); shd.setAttribute('ry', tr + 1);
  shd.setAttribute('fill', 'rgba(0,0,0,.25)');
  g.appendChild(shd);
  // Table surface (wood)
  const tc = nsEl('circle');
  tc.setAttribute('cx', cx); tc.setAttribute('cy', cy); tc.setAttribute('r', tr);
  tc.setAttribute('fill', 'url(#vd-wood)');
  tc.setAttribute('stroke', '#3a2518'); tc.setAttribute('stroke-width', 1.5);
  g.appendChild(tc);
  // Table highlight
  const thl = nsEl('ellipse');
  thl.setAttribute('cx', cx - tr * .2); thl.setAttribute('cy', cy - tr * .2);
  thl.setAttribute('rx', tr * .5); thl.setAttribute('ry', tr * .35);
  thl.setAttribute('fill', 'rgba(255,255,255,.08)');
  g.appendChild(thl);
  // Chairs around
  const n = el.seats || 6;
  const sr = tr + 10;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI / n) * i - Math.PI / 2;
    const px = cx + sr * Math.cos(angle);
    const py = cy + sr * Math.sin(angle);
    // Chair body
    const ch = nsEl('rect');
    const cw = 5, chh = 6;
    ch.setAttribute('x', px - cw / 2); ch.setAttribute('y', py - chh / 2);
    ch.setAttribute('width', cw); ch.setAttribute('height', chh);
    ch.setAttribute('rx', 1.5);
    ch.setAttribute('fill', el.color); ch.setAttribute('opacity', '.7');
    ch.setAttribute('transform', `rotate(${(angle * 180 / Math.PI) + 90},${px},${py})`);
    g.appendChild(ch);
  }
  // Label
  const lbl = nsEl('text');
  lbl.setAttribute('x', cx); lbl.setAttribute('y', cy + 2);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle');
  lbl.setAttribute('fill', '#f3e5ab'); lbl.setAttribute('font-size', 7);
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
    this.snapToGrid = opts.snapToGrid || false;
    this.gridSize = opts.gridSize || 10;
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
        let nx = Math.round(p.x - this._dragging.offsetX);
        let ny = Math.round(p.y - this._dragging.offsetY);
        if (this.snapToGrid) {
          nx = Math.round(nx / this.gridSize) * this.gridSize;
          ny = Math.round(ny / this.gridSize) * this.gridSize;
        }
        this._dragging.el.x = nx;
        this._dragging.el.y = ny;
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
