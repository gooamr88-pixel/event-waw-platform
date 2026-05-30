/* ===================================
   EVENTSLI - Venue Designer Persistence
   =================================== */

import { supabase } from './supabase.js';
import { ROW_GAP, SEAT_GAP, SEAT_R } from './vd-engine.js';

export async function saveVenueMapV2(eventId, engine, sectionTiers = {}) {
  const layoutJson = engine.toLayoutJSON();

  const { data: existingMap } = await supabase
    .from('venue_maps').select('id, version').eq('event_id', eventId).maybeSingle();

  let mapId, version = 1;

  if (existingMap) {
    version = (existingMap.version || 1) + 1;

    // H22 FIX: Back up existing seats before delete-and-reinsert
    // The Supabase JS client doesn't support transactions, so we use a backup-restore pattern.
    // TODO: Migrate to a SECURITY DEFINER RPC that wraps this in a single SQL transaction.
    const { data: backupSeats } = await supabase.from('seats')
      .select('venue_map_id, section_key, row_label, seat_number, ticket_tier_id, status')
      .eq('venue_map_id', existingMap.id);

    const { error } = await supabase.from('venue_maps')
      .update({ layout_json: layoutJson, version }).eq('id', existingMap.id);
    if (error) throw new Error(`Failed to update venue map: ${error.message}`);
    mapId = existingMap.id;
    await supabase.from('seats').delete().eq('venue_map_id', mapId);

    // Insert new seats with rollback on failure
    try {
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
        const { error: batchErr } = await supabase.from('seats').insert(batch);
        if (batchErr) throw new Error(`Seat insert failed at batch ${Math.floor(i/BATCH)+1}: ${batchErr.message}`);
        inserted += batch.length;
      }
      return { mapId, seatCount: inserted, version };
    } catch (insertErr) {
      // H22: Attempt to restore original seats on failure
      console.error('Seat save failed, attempting rollback:', insertErr.message);
      if (backupSeats?.length) {
        try {
          await supabase.from('seats').delete().eq('venue_map_id', mapId);
          for (let i = 0; i < backupSeats.length; i += 500) {
            await supabase.from('seats').insert(backupSeats.slice(i, i + 500));
          }
          console.log(`Rollback successful: restored ${backupSeats.length} seats`);
        } catch (rollbackErr) {
          console.error('CRITICAL: Rollback also failed:', rollbackErr.message);
        }
      }
      throw new Error(`Save failed and was rolled back. Please retry. (${insertErr.message})`);
    }
  } else {
    const { data, error } = await supabase.from('venue_maps')
      .insert({ event_id: eventId, layout_json: layoutJson, version: 1 }).select('id').single();
    if (error) throw new Error(`Failed to create venue map: ${error.message}`);
    mapId = data.id;
  }

  // Bulk-insert seats from sections (new venue map — no rollback needed)
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
