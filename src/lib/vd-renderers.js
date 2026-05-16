/* ===================================
   EVENTSLI - Venue Designer Renderers
   =================================== */

export function renderCanvas(elements, container, state, ELEMENT_TYPES, SEAT_R, SEAT_GAP, ROW_GAP) {
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

  svg.querySelectorAll(':not(defs)').forEach(n => n.remove());

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

  // ── Background Image (floor plan) ──
  if (state.bgImage) {
    const bgImg = nsEl('image');
    bgImg.setAttribute('href', state.bgImage);
    bgImg.setAttribute('x', 0);
    bgImg.setAttribute('y', 0);
    bgImg.setAttribute('width', cw);
    bgImg.setAttribute('height', ch);
    bgImg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    bgImg.setAttribute('opacity', '0.35');
    bgImg.style.pointerEvents = 'none';
    svg.appendChild(bgImg);
  }


  const spot = nsEl('ellipse');
  spot.setAttribute('cx', cw / 2); spot.setAttribute('cy', ch * .35);
  spot.setAttribute('rx', cw * .4); spot.setAttribute('ry', ch * .3);
  spot.setAttribute('fill', 'url(#vd-spot)');
  svg.appendChild(spot);

  for (const el of elements) {
    const g = nsEl('g');
    g.setAttribute('data-id', el.id);
    g.setAttribute('transform', `translate(${el.x},${el.y})${el.rotation ? ` rotate(${el.rotation},${el.w/2},${el.h/2})` : ''}`);
    g.style.cursor = el.locked ? 'not-allowed' : 'grab';

    if (el.type === 'stage') {
      renderStage(g, el);
    } else if (el.type === 'section') {
      renderSection(g, el, SEAT_GAP, ROW_GAP, SEAT_R);
    } else if (el.type === 'table') {
      renderTable(g, el);
    } else if (el.type === 'barrier') {
      renderBarrier(g, el);
    } else {
      renderGenericElement(g, el, ELEMENT_TYPES);
    }

    if (state.selectedId === el.id) {
      const sel = nsEl('rect');
      sel.setAttribute('x', -3); sel.setAttribute('y', -3);
      sel.setAttribute('width', (el.w || 80) + 6); sel.setAttribute('height', (el.h || 80) + 6);
      sel.setAttribute('rx', 4);
      sel.setAttribute('fill', 'none'); sel.setAttribute('stroke', '#d4af37');
      sel.setAttribute('stroke-width', 1.5); sel.setAttribute('stroke-dasharray', '4 3');
      sel.setAttribute('class', 'vd-sel-ring');
      g.insertBefore(sel, g.firstChild);

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
  const floor = nsEl('rect');
  floor.setAttribute('width', w); floor.setAttribute('height', h);
  floor.setAttribute('rx', 4); floor.setAttribute('fill', 'url(#vd-wood)');
  floor.setAttribute('stroke', '#3a2518'); floor.setAttribute('stroke-width', 1.5);
  floor.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(floor);
  for (let i = 1; i < 6; i++) {
    const ln = nsEl('line');
    ln.setAttribute('x1', w * i / 6); ln.setAttribute('y1', 0);
    ln.setAttribute('x2', w * i / 6); ln.setAttribute('y2', h);
    ln.setAttribute('stroke', 'rgba(0,0,0,.15)'); ln.setAttribute('stroke-width', .5);
    g.appendChild(ln);
  }
  const edge = nsEl('rect');
  edge.setAttribute('width', w); edge.setAttribute('height', 3);
  edge.setAttribute('y', h - 3); edge.setAttribute('rx', 1);
  edge.setAttribute('fill', 'url(#vd-stage-g)'); edge.setAttribute('opacity', .8);
  g.appendChild(edge);
  const lc = nsEl('rect');
  lc.setAttribute('width', 12); lc.setAttribute('height', h);
  lc.setAttribute('rx', 2); lc.setAttribute('fill', 'url(#vd-curtain-l)');
  lc.setAttribute('opacity', .85);
  g.appendChild(lc);
  const rc = nsEl('rect');
  rc.setAttribute('x', w - 12); rc.setAttribute('width', 12); rc.setAttribute('height', h);
  rc.setAttribute('rx', 2); rc.setAttribute('fill', 'url(#vd-curtain-l)');
  rc.setAttribute('opacity', .85);
  g.appendChild(rc);
  const lbl = nsEl('text');
  lbl.setAttribute('x', w / 2); lbl.setAttribute('y', h / 2 + 1);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle');
  lbl.setAttribute('fill', '#f3e5ab'); lbl.setAttribute('font-size', 11);
  lbl.setAttribute('font-weight', 700); lbl.setAttribute('font-family', 'Inter, sans-serif');
  lbl.setAttribute('letter-spacing', '2');
  lbl.textContent = el.label.toUpperCase();
  g.appendChild(lbl);
}

function renderGenericElement(g, el, ELEMENT_TYPES) {
  const w = el.w || 80, h = el.h || 80;
  const c = el.color;
  const glow = nsEl('rect');
  glow.setAttribute('x', -4); glow.setAttribute('y', -4);
  glow.setAttribute('width', w + 8); glow.setAttribute('height', h + 8);
  glow.setAttribute('rx', (el.cornerRadius || 8) + 4);
  glow.setAttribute('fill', c + '08'); glow.setAttribute('stroke', 'none');
  g.appendChild(glow);
  const r = nsEl('rect');
  r.setAttribute('width', w); r.setAttribute('height', h);
  r.setAttribute('rx', el.cornerRadius || 8);
  r.setAttribute('fill', c + '15');
  r.setAttribute('stroke', c + '40'); r.setAttribute('stroke-width', 1);
  r.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(r);
  const hi = nsEl('rect');
  hi.setAttribute('x', 2); hi.setAttribute('y', 2);
  hi.setAttribute('width', w - 4); hi.setAttribute('height', h * .4);
  hi.setAttribute('rx', (el.cornerRadius || 8) - 1);
  hi.setAttribute('fill', 'rgba(255,255,255,.03)');
  g.appendChild(hi);
  const icon = nsEl('text');
  icon.setAttribute('x', w / 2); icon.setAttribute('y', h / 2 - (h > 40 ? 6 : 0));
  icon.setAttribute('text-anchor', 'middle'); icon.setAttribute('dominant-baseline', 'middle');
  icon.setAttribute('font-size', Math.min(h * .35, 24));
  icon.textContent = (ELEMENT_TYPES[el.type.toUpperCase()] || {}).icon || '';
  g.appendChild(icon);
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
  const rail = nsEl('rect');
  rail.setAttribute('width', w); rail.setAttribute('height', h);
  rail.setAttribute('rx', h / 2); rail.setAttribute('fill', 'url(#vd-metal)');
  rail.setAttribute('stroke', '#555'); rail.setAttribute('stroke-width', .5);
  rail.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(rail);
  for (let i = 0; i <= 1; i++) {
    const p = nsEl('rect');
    p.setAttribute('x', i === 0 ? 0 : w - 4);
    p.setAttribute('y', -6); p.setAttribute('width', 4); p.setAttribute('height', h + 12);
    p.setAttribute('rx', 2); p.setAttribute('fill', '#777');
    p.setAttribute('stroke', '#555'); p.setAttribute('stroke-width', .5);
    g.appendChild(p);
  }
  const hl = nsEl('rect');
  hl.setAttribute('width', w); hl.setAttribute('height', h * .35);
  hl.setAttribute('rx', h / 2);
  hl.setAttribute('fill', 'rgba(255,255,255,.12)');
  g.appendChild(hl);
}

function renderSection(g, el, SEAT_GAP, ROW_GAP, SEAT_R) {
  const w = el.w, h = el.h;
  const r = nsEl('rect');
  r.setAttribute('width', w); r.setAttribute('height', h);
  r.setAttribute('rx', 8);
  r.setAttribute('fill', el.color + '08');
  r.setAttribute('stroke', el.color + '20'); r.setAttribute('stroke-width', 1);
  r.setAttribute('filter', 'url(#vd-shadow)');
  g.appendChild(r);
  const hi = nsEl('rect');
  hi.setAttribute('x', 1); hi.setAttribute('y', 1);
  hi.setAttribute('width', w - 2); hi.setAttribute('height', 18);
  hi.setAttribute('rx', 7);
  hi.setAttribute('fill', el.color + '0a');
  g.appendChild(hi);
  const lbl = nsEl('text');
  lbl.setAttribute('x', w / 2); lbl.setAttribute('y', 13);
  lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('font-size', 9);
  lbl.setAttribute('fill', el.color); lbl.setAttribute('font-weight', 700);
  lbl.setAttribute('font-family', 'Inter, sans-serif');
  lbl.setAttribute('letter-spacing', '.5');
  lbl.textContent = el.label;
  g.appendChild(lbl);

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
      const back = nsEl('path');
      const bw = sr * 1.6, bh = sr * .8;
      back.setAttribute('d', `M${sx - bw},${sy - sr * .5} Q${sx},${sy - sr * 1.6} ${sx + bw},${sy - sr * .5}`);
      back.setAttribute('fill', 'none'); back.setAttribute('stroke', el.color);
      back.setAttribute('stroke-width', 1); back.setAttribute('opacity', '.5');
      g.appendChild(back);
      const seat = nsEl('rect');
      seat.setAttribute('x', sx - sr); seat.setAttribute('y', sy - sr * .5);
      seat.setAttribute('width', sr * 2); seat.setAttribute('height', sr * 1.4);
      seat.setAttribute('rx', sr * .4);
      seat.setAttribute('fill', el.color); seat.setAttribute('opacity', '.65');
      g.appendChild(seat);
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
  const shd = nsEl('ellipse');
  shd.setAttribute('cx', cx + 1); shd.setAttribute('cy', cy + 2);
  shd.setAttribute('rx', tr + 2); shd.setAttribute('ry', tr + 1);
  shd.setAttribute('fill', 'rgba(0,0,0,.25)');
  g.appendChild(shd);
  const tc = nsEl('circle');
  tc.setAttribute('cx', cx); tc.setAttribute('cy', cy); tc.setAttribute('r', tr);
  tc.setAttribute('fill', 'url(#vd-wood)');
  tc.setAttribute('stroke', '#3a2518'); tc.setAttribute('stroke-width', 1.5);
  g.appendChild(tc);
  const thl = nsEl('ellipse');
  thl.setAttribute('cx', cx - tr * .2); thl.setAttribute('cy', cy - tr * .2);
  thl.setAttribute('rx', tr * .5); thl.setAttribute('ry', tr * .35);
  thl.setAttribute('fill', 'rgba(255,255,255,.08)');
  g.appendChild(thl);
  const n = el.seats || 6;
  const sr = tr + 10;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI / n) * i - Math.PI / 2;
    const px = cx + sr * Math.cos(angle);
    const py = cy + sr * Math.sin(angle);
    const ch = nsEl('rect');
    const cw = 5, chh = 6;
    ch.setAttribute('x', px - cw / 2); ch.setAttribute('y', py - chh / 2);
    ch.setAttribute('width', cw); ch.setAttribute('height', chh);
    ch.setAttribute('rx', 1.5);
    ch.setAttribute('fill', el.color); ch.setAttribute('opacity', '.7');
    ch.setAttribute('transform', `rotate(${(angle * 180 / Math.PI) + 90},${px},${py})`);
    g.appendChild(ch);
  }
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
