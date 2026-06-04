/* ===================================
   EVENTSLI - Venue Designer Persistence
   =================================== */

import { supabase } from './supabase.js';
import { ROW_GAP, SEAT_GAP, SEAT_R } from './vd-engine.js';

/**
 * Save or update the venue map for an event.
 *
 * Uses a SMART MERGE strategy instead of delete-and-reinsert:
 *   • Existing seats with active bookings (sold/reserved) are PRESERVED.
 *   • New seats are inserted as 'available'.
 *   • Removed seats that are available/blocked are deleted.
 *   • Tier assignments are updated only on non-booked seats.
 *   • If the new layout would remove any sold/reserved seats, the save is
 *     BLOCKED with a descriptive error message.
 */
export async function saveVenueMapV2(eventId, engine, sectionTiers = {}) {
  const layoutJson = engine.toLayoutJSON();

  const { data: existingMap } = await supabase
    .from('venue_maps').select('id, version').eq('event_id', eventId).maybeSingle();

  let mapId, version = 1;

  if (existingMap) {
    version = (existingMap.version || 1) + 1;
    mapId = existingMap.id;

    // ── 1. Fetch existing seats with full booking state ──
    const { data: oldSeats, error: fetchErr } = await supabase.from('seats')
      .select('id, section_key, row_label, seat_number, ticket_tier_id, status, reservation_id, ticket_id, locked_until, price_override, seat_category, row_tier_id, promo_code_lock, notes, custom_row_name')
      .eq('venue_map_id', mapId);

    if (fetchErr) throw new Error(`Failed to fetch existing seats: ${fetchErr.message}`);

    // ── 2. Build lookup: "section::row::number" → seat record ──
    const oldMap = new Map();
    for (const s of (oldSeats || [])) {
      oldMap.set(`${s.section_key}::${s.row_label}::${s.seat_number}`, s);
    }

    // ── 3. Classify seats: keep / insert / update-tier ──
    const validTierIds = new Set((engine?.tiers || []).map(t => t.id));
    const newSeatKeys = new Set();
    const toInsert = [];
    const tierUpdates = new Map(); // tierId → [seatId, ...]
    const overrideUpdates = []; // { id, props }

    for (const section of layoutJson.sections) {
      let tierId = sectionTiers[section.key] || section.tier_id || null;
      if (tierId && !validTierIds.has(tierId)) tierId = null;
      const overrides = section.seatOverrides || {};
      const rowNames = section.customRowNames || {};

      for (const row of section.rows) {
        const customRowName = rowNames[row.label] || row.customName || null;
        for (const seat of row.seats) {
          const key = `${section.key}::${row.label}::${seat.number}`;
          const seatKey = `${row.label}::${seat.number}`;
          const ovr = overrides[seatKey] || {};
          newSeatKeys.add(key);

          // Resolve effective tier: seat override > row override > section tier
          const rowTierId = ovr.tier_id || null;
          const effectiveStatus = ovr.status || 'available';

          const existing = oldMap.get(key);
          if (existing) {
            // Only update non-booked seats (financial integrity)
            if (existing.status === 'available' || existing.status === 'blocked') {
              // Tier update
              if (existing.ticket_tier_id !== tierId) {
                const groupKey = tierId || '__null__';
                if (!tierUpdates.has(groupKey)) tierUpdates.set(groupKey, []);
                tierUpdates.get(groupKey).push(existing.id);
              }
              // Override updates — diff each property
              const props = {};
              if (existing.price_override != ovr.price_override) props.price_override = ovr.price_override ?? null;
              if (existing.seat_category !== (ovr.category || 'standard')) props.seat_category = ovr.category || 'standard';
              if (existing.row_tier_id !== (rowTierId || null)) props.row_tier_id = rowTierId || null;
              if (existing.promo_code_lock !== (ovr.promo_lock || null)) props.promo_code_lock = ovr.promo_lock || null;
              if (existing.notes !== (ovr.notes || null)) props.notes = ovr.notes || null;
              if (existing.custom_row_name !== customRowName) props.custom_row_name = customRowName;
              if (existing.status !== effectiveStatus) props.status = effectiveStatus;
              if (Object.keys(props).length > 0) {
                overrideUpdates.push({ id: existing.id, props });
              }
            }
          } else {
            // New seat — include override properties on insert
            toInsert.push({
              venue_map_id: mapId,
              section_key: section.key,
              row_label: row.label,
              seat_number: seat.number,
              ticket_tier_id: tierId,
              status: effectiveStatus,
              price_override: ovr.price_override ?? null,
              seat_category: ovr.category || 'standard',
              row_tier_id: rowTierId || null,
              promo_code_lock: ovr.promo_lock || null,
              notes: ovr.notes || null,
              custom_row_name: customRowName,
            });
          }
        }
      }
    }

    // ── 4. Find seats to remove (in old but not in new layout) ──
    const toDeleteIds = [];
    const conflictSeats = [];

    for (const [key, seat] of oldMap) {
      if (!newSeatKeys.has(key)) {
        if (seat.status === 'sold' || seat.status === 'reserved') {
          conflictSeats.push(seat);
        } else {
          toDeleteIds.push(seat.id);
        }
      }
    }

    // ── 5. Block save if sold/reserved seats would be removed ──
    if (conflictSeats.length > 0) {
      const details = conflictSeats.slice(0, 5).map(s =>
        `${s.section_key} Row ${s.row_label} Seat ${s.seat_number} (${s.status})`
      ).join(', ');
      const extra = conflictSeats.length > 5 ? ` and ${conflictSeats.length - 5} more` : '';
      throw new Error(
        `Cannot save: ${conflictSeats.length} seat(s) have active bookings and would be removed. ` +
        `Affected: ${details}${extra}. ` +
        `Keep those sections in the layout or refund the tickets first.`
      );
    }

    // ── 6. Update layout_json ──
    const { error: updateErr } = await supabase.from('venue_maps')
      .update({ layout_json: layoutJson, version }).eq('id', mapId);
    if (updateErr) throw new Error(`Failed to update venue map: ${updateErr.message}`);

    // ── 7. Delete removed available/blocked seats ──
    if (toDeleteIds.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < toDeleteIds.length; i += BATCH) {
        const batch = toDeleteIds.slice(i, i + BATCH);
        const { error: delErr } = await supabase.from('seats').delete().in('id', batch);
        if (delErr) console.error('Seat delete batch failed:', delErr.message);
      }
    }

    // ── 8. Update tier on existing available/blocked seats ──
    for (const [groupKey, ids] of tierUpdates) {
      const tierId = groupKey === '__null__' ? null : groupKey;
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const { error: updErr } = await supabase.from('seats')
          .update({ ticket_tier_id: tierId }).in('id', batch);
        if (updErr) console.error('Seat tier update failed:', updErr.message);
      }
    }

    // ── 8b. Apply per-seat override updates ──
    if (overrideUpdates.length > 0) {
      for (const upd of overrideUpdates) {
        const { error: ovrErr } = await supabase.from('seats')
          .update(upd.props).eq('id', upd.id);
        if (ovrErr) console.error('Seat override update failed:', ovrErr.message);
      }
    }

    // ── 9. Insert new seats ──
    let inserted = 0;
    if (toInsert.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH);
        const { error: insErr } = await supabase.from('seats').insert(batch);
        if (insErr) throw new Error(`Seat insert failed: ${insErr.message}`);
        inserted += batch.length;
      }
    }

    const preserved = (oldSeats?.length || 0) - toDeleteIds.length;
    const tierUpdateCount = [...tierUpdates.values()].reduce((sum, ids) => sum + ids.length, 0);
    return { mapId, version, seatCount: preserved + inserted, preserved, added: inserted, removed: toDeleteIds.length, tierUpdated: tierUpdateCount };

  } else {
    // ── New map: insert + bulk-insert available seats ──
    const { data, error } = await supabase.from('venue_maps')
      .insert({ event_id: eventId, layout_json: layoutJson, version: 1 }).select('id').single();
    if (error) throw new Error(`Failed to create venue map: ${error.message}`);
    mapId = data.id;

    const validTierIds = new Set((engine?.tiers || []).map(t => t.id));
    const seatRows = [];
    for (const section of layoutJson.sections) {
      let tierId = sectionTiers[section.key] || section.tier_id || null;
      if (tierId && !validTierIds.has(tierId)) tierId = null;
      const overrides = section.seatOverrides || {};
      const rowNames = section.customRowNames || {};

      for (const row of section.rows) {
        const customRowName = rowNames[row.label] || row.customName || null;
        for (const seat of row.seats) {
          const seatKey = `${row.label}::${seat.number}`;
          const ovr = overrides[seatKey] || {};
          seatRows.push({
            venue_map_id: mapId, section_key: section.key,
            row_label: row.label, seat_number: seat.number,
            ticket_tier_id: tierId, status: ovr.status || 'available',
            price_override: ovr.price_override ?? null,
            seat_category: ovr.category || 'standard',
            row_tier_id: ovr.tier_id || null,
            promo_code_lock: ovr.promo_lock || null,
            notes: ovr.notes || null,
            custom_row_name: customRowName,
          });
        }
      }
    }

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < seatRows.length; i += BATCH) {
      const batch = seatRows.slice(i, i + BATCH);
      const { error: batchErr } = await supabase.from('seats').insert(batch);
      if (batchErr) throw new Error(`Seat insert failed: ${batchErr.message}`);
      inserted += batch.length;
    }

    return { mapId, seatCount: inserted, version: 1, preserved: 0, added: inserted, removed: 0 };
  }
}
