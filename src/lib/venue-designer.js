/* ═══════════════════════════════════
   EVENT WAW — Venue Designer Engine
   Generates layout_json + bulk-creates seats
   ═══════════════════════════════════ */

import { supabase } from './supabase.js';

// ── Layout generation constants ──
const SEAT_RADIUS = 6;
const SEAT_GAP = 16;        // center-to-center distance between seats
const ROW_GAP = 18;         // vertical gap between rows
const SECTION_GAP = 50;     // vertical gap between sections
const LABEL_OFFSET = 20;    // space for row label on the left
const CANVAS_PADDING = 60;

/**
 * Auto-generate layout_json from a simple section definition.
 *
 * @param {object} config
 * @param {object} config.stage - { label, width, height }
 * @param {Array} config.sections - [{ key, label, tier_id, rows, seatsPerRow, curveRadius? }]
 * @param {number} config.canvasWidth
 * @returns {object} layout_json
 */
export function generateLayout(config) {
  const { stage, sections, canvasWidth = 1200 } = config;
  const stageWidth = stage?.width || 500;
  const stageHeight = stage?.height || 70;
  const stageX = (canvasWidth - stageWidth) / 2;
  const stageY = CANVAS_PADDING;

  const layout = {
    canvas: { width: canvasWidth, height: 0 }, // height computed below
    stage: {
      x: stageX,
      y: stageY,
      width: stageWidth,
      height: stageHeight,
      label: stage?.label || 'STAGE',
    },
    sections: [],
  };

  let currentY = stageY + stageHeight + SECTION_GAP;

  for (const sec of sections) {
    const sectionRows = [];
    const rowCount = sec.rows || 1;
    const seatsPerRow = sec.seatsPerRow || 10;
    const curveRadius = sec.curveRadius || 0;

    // Calculate section width
    const sectionWidth = seatsPerRow * SEAT_GAP;
    const sectionStartX = (canvasWidth - sectionWidth) / 2;

    // Section label position
    const labelX = canvasWidth / 2;
    const labelY = currentY;
    currentY += 24; // space after section label

    for (let r = 0; r < rowCount; r++) {
      const rowLabel = String.fromCharCode(65 + r); // A, B, C, ...
      const seats = [];

      for (let s = 0; s < seatsPerRow; s++) {
        let x = sectionStartX + (s * SEAT_GAP) + LABEL_OFFSET;
        let y = currentY;

        // Apply curve (arc effect)
        if (curveRadius > 0) {
          const center = sectionStartX + (seatsPerRow * SEAT_GAP) / 2;
          const dx = x - center;
          const curve = Math.sqrt(Math.max(0, curveRadius * curveRadius - dx * dx));
          y = currentY + (curveRadius - curve) * 0.15;
        }

        seats.push({
          number: String(s + 1),
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          r: SEAT_RADIUS,
        });
      }

      sectionRows.push({
        label: rowLabel,
        labelX: sectionStartX,
        labelY: currentY + 4,
        seats,
      });

      currentY += ROW_GAP;
    }

    layout.sections.push({
      key: sec.key,
      label: sec.label || sec.key,
      labelX: labelX,
      labelY: labelY,
      tier_id: sec.tier_id || null,
      rows: sectionRows,
    });

    currentY += SECTION_GAP;
  }

  layout.canvas.height = Math.max(currentY + CANVAS_PADDING, 400);

  return layout;
}

/**
 * Save a venue map to the database.
 * Creates or updates the venue_maps row, then bulk-inserts seats.
 *
 * @param {string} eventId
 * @param {object} layoutJson - from generateLayout()
 * @param {object} sectionTiers - { sectionKey: tier_id } mapping
 * @returns {{ mapId, seatCount }}
 */
export async function saveVenueMap(eventId, layoutJson, sectionTiers = {}) {
  // 1. Upsert venue_maps row
  const { data: existingMap } = await supabase
    .from('venue_maps')
    .select('id, version')
    .eq('event_id', eventId)
    .maybeSingle();

  let mapId;
  let version = 1;

  if (existingMap) {
    // Update existing map
    version = (existingMap.version || 1) + 1;
    const { error } = await supabase
      .from('venue_maps')
      .update({
        layout_json: layoutJson,
        version,
      })
      .eq('id', existingMap.id);

    if (error) throw new Error(`Failed to update venue map: ${error.message}`);
    mapId = existingMap.id;

    // Delete old seats (they'll be regenerated)
    await supabase.from('seats').delete().eq('venue_map_id', mapId);
  } else {
    // Create new map
    const { data, error } = await supabase
      .from('venue_maps')
      .insert({
        event_id: eventId,
        layout_json: layoutJson,
        version: 1,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create venue map: ${error.message}`);
    mapId = data.id;
  }

  // 2. Bulk-insert seats from layout_json
  const seatRows = [];

  for (const section of layoutJson.sections) {
    const tierId = sectionTiers[section.key] || section.tier_id || null;

    for (const row of section.rows) {
      for (const seat of row.seats) {
        seatRows.push({
          venue_map_id: mapId,
          section_key: section.key,
          row_label: row.label,
          seat_number: seat.number,
          ticket_tier_id: tierId,
          status: 'available',
        });
      }
    }
  }

  // Insert in batches of 500 (Supabase limit)
  let inserted = 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < seatRows.length; i += BATCH_SIZE) {
    const batch = seatRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('seats').insert(batch);
    if (error) throw new Error(`Failed to insert seats (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`);
    inserted += batch.length;
  }

  return { mapId, seatCount: inserted, version };
}

/**
 * Delete a venue map and all its seats.
 */
export async function deleteVenueMap(eventId) {
  const { data: map } = await supabase
    .from('venue_maps')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle();

  if (!map) return;

  // Seats cascade-delete via FK, but let's be explicit
  await supabase.from('seats').delete().eq('venue_map_id', map.id);
  await supabase.from('venue_maps').delete().eq('id', map.id);
}

/**
 * Load existing venue map for editing.
 */
export async function loadVenueMap(eventId) {
  const { data, error } = await supabase
    .from('venue_maps')
    .select('id, layout_json, version')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Render an SVG preview of the layout (static, no panzoom).
 */
export function renderPreviewSVG(layoutJson, container) {
  const layout = layoutJson;
  const canvas = layout.canvas || { width: 1200, height: 800 };

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
  svg.setAttribute('class', 'designer-preview-svg');
  svg.style.width = '100%';
  svg.style.height = '100%';

  // Background
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', canvas.width);
  bg.setAttribute('height', canvas.height);
  bg.setAttribute('fill', 'transparent');
  svg.appendChild(bg);

  // Stage
  if (layout.stage) {
    const st = layout.stage;
    const stageRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    stageRect.setAttribute('x', st.x);
    stageRect.setAttribute('y', st.y);
    stageRect.setAttribute('width', st.width);
    stageRect.setAttribute('height', st.height);
    stageRect.setAttribute('rx', '8');
    stageRect.setAttribute('class', 'stage-rect');
    svg.appendChild(stageRect);

    const stageLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    stageLabel.setAttribute('x', st.x + st.width / 2);
    stageLabel.setAttribute('y', st.y + st.height / 2 + 5);
    stageLabel.setAttribute('text-anchor', 'middle');
    stageLabel.setAttribute('class', 'stage-label');
    stageLabel.textContent = st.label || 'STAGE';
    svg.appendChild(stageLabel);
  }

  // Sections
  const tierColors = ['#d4af37', '#8b5cf6', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#14b8a6', '#ef4444'];
  const tierColorMap = {};
  let colorIdx = 0;

  for (const section of (layout.sections || [])) {
    const tierId = section.tier_id || section.key;
    if (!tierColorMap[tierId]) {
      tierColorMap[tierId] = tierColors[colorIdx % tierColors.length];
      colorIdx++;
    }
    const color = tierColorMap[tierId];

    // Section label
    if (section.labelX) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', section.labelX);
      label.setAttribute('y', section.labelY || 0);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'section-label');
      label.textContent = section.label;
      svg.appendChild(label);
    }

    for (const row of (section.rows || [])) {
      // Row label
      if (row.labelX !== undefined) {
        const rowLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        rowLabel.setAttribute('x', row.labelX);
        rowLabel.setAttribute('y', row.labelY || 0);
        rowLabel.setAttribute('text-anchor', 'middle');
        rowLabel.setAttribute('class', 'row-label');
        rowLabel.textContent = row.label;
        svg.appendChild(rowLabel);
      }

      for (const seat of (row.seats || [])) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', seat.x);
        circle.setAttribute('cy', seat.y);
        circle.setAttribute('r', seat.r || SEAT_RADIUS);
        circle.setAttribute('fill', color);
        circle.setAttribute('opacity', '0.85');
        circle.setAttribute('class', 'seat');
        svg.appendChild(circle);
      }
    }
  }

  container.innerHTML = '';
  container.appendChild(svg);
}
