// test-delete.js
import { supabase } from './js/supabase.js';

async function testDelete() {
  console.log("Testing delete...");
  const { data: events, error: err1 } = await supabase.from('events').select('id').limit(1);
  if (err1 || !events.length) {
    console.log("No events found or error", err1);
    return;
  }
  const eventId = events[0].id;
  console.log("Trying to delete event:", eventId);
  const { error } = await supabase.rpc('admin_delete_event', { p_event_id: eventId });
  console.log("Result:", error);
}

testDelete();
