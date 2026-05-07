/* ===================================
   EVENT WAW - Venue Designer Engine Core
   =================================== */

import { renderCanvas } from './vd-renderers.js';

export const SEAT_R = 5;
export const SEAT_GAP = 14;
export const ROW_GAP = 16;

export const ELEMENT_TYPES = {
  STAGE:     { id: 'stage',     label: 'Stage',        icon: '🎤', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>', color: '#d4af37' },
  SECTION:   { id: 'section',   label: 'Seat Section', icon: '💺', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>', color: '#3b82f6' },
  BAR:       { id: 'bar',       label: 'Bar / Drinks', icon: '🍸', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2l-4 9h16l-4-9"/><path d="M12 11v9"/><path d="M8 20h8"/><path d="M7 5h10"/></svg>', color: '#8b5cf6' },
  VIP:       { id: 'vip',       label: 'VIP Lounge',   icon: '👑', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18l3-8 5 4 2-10 2 10 5-4 3 8H2z"/><path d="M2 18h20v2H2z"/></svg>', color: '#f59e0b' },
  TABLE:     { id: 'table',     label: 'Table',        icon: '🍽️', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>', color: '#22c55e' },
  BARRIER:   { id: 'barrier',   label: 'Barrier',      icon: '🚧', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="20" height="8" rx="1"/><line x1="6" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="18" y2="16"/></svg>', color: '#ef4444' },
  RESTROOM:  { id: 'restroom',  label: 'Restroom',     icon: '🚻', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="4" r="2"/><path d="M8 8v4l-2 6"/><path d="M8 12l2 6"/><path d="M6 8h4"/><circle cx="17" cy="4" r="2"/><path d="M14 8h6l-2 6h-2l-2-6z"/><path d="M15 14v6"/><path d="M19 14v6"/></svg>', color: '#6b7280' },
  EXIT:      { id: 'exit',      label: 'Exit',         icon: '🚪', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>', color: '#14b8a6' },
  FOOD:      { id: 'food',      label: 'Food Court',   icon: '🍕', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>', color: '#3B82F6' },
  DJ:        { id: 'dj',        label: 'DJ Booth',     icon: '🎧', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/></svg>', color: '#ec4899' },
  MERCH:     { id: 'merch',     label: 'Merchandise',  icon: '🛍️', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>', color: '#a855f7' },
  SCREEN:    { id: 'screen',    label: 'Screen',       icon: '📺', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', color: '#06b6d4' },
  ENTRANCE:  { id: 'entrance',  label: 'Entrance',     icon: '🚶', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>', color: '#10b981' },
  PHOTO:     { id: 'photo',     label: 'Photo Booth',  icon: '📸', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>', color: '#e879f9' },
  LABEL:     { id: 'label',     label: 'Text Label',   icon: '🏷️', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>', color: '#94a3b8' },
};

let _idCounter = 0;
export function uid() { return 'el-' + (++_idCounter) + '-' + Date.now().toString(36); }

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

  render() { 
    renderCanvas(this.elements, this.container, this.state, ELEMENT_TYPES, SEAT_R, SEAT_GAP, ROW_GAP); 
  }

  toLayoutJSON() {
    return {
      version: 2,
      canvas: { width: this.state.canvasW, height: this.state.canvasH },
      elements: this.elements.map(e => ({ ...e })),
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

      if (e.button === 0 && !g) {
        this._panning = true;
        this._panStart = { x: e.clientX - this.state.panX, y: e.clientY - this.state.panY };
        c.style.cursor = 'grabbing';
      }

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

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { this.removeSelected(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'z') { this.undo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'y') { this.redo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'd') { this.duplicateSelected(); e.preventDefault(); }
    });

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
