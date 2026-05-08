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
