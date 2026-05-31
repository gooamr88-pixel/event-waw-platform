import fs from 'fs';

// Read the credentials from src/lib/supabase.js
const supabaseFile = fs.readFileSync('c:\\Users\\yousef amr\\Desktop\\events platform\\src\\lib\\supabase.js', 'utf8');
const urlMatch = supabaseFile.match(/const supabaseUrl = '([^']+)';/);
const keyMatch = supabaseFile.match(/const supabaseAnonKey = '([^']+)';/);

if (!urlMatch || !keyMatch) {
  console.log("Could not find credentials");
  process.exit(1);
}

const supabaseUrl = urlMatch[1];
const supabaseAnonKey = keyMatch[1];

async function callSupabase(path, query = '') {
  const url = `${supabaseUrl}/rest/v1/${path}${query}`;
  const response = await fetch(url, {
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function run() {
  try {
    // Fetch latest event
    const events = await callSupabase('events', '?select=id,title&order=created_at.desc&limit=1');
    if (!events || events.length === 0) {
      console.log("No events found");
      return;
    }
    const event = events[0];
    console.log(`Latest event: "${event.title}" (${event.id})`);

    // Fetch ticket tiers for this event
    const tiers = await callSupabase('ticket_tiers', `?select=id,name,price&event_id=eq.${event.id}`);
    console.log("Ticket Tiers for this event:", tiers);

    // Fetch venue maps for this event
    const maps = await callSupabase('venue_maps', `?select=id,layout_json,version&event_id=eq.${event.id}`);
    console.log("Venue maps count:", maps?.length);
    if (maps && maps.length > 0) {
      const map = maps[0];
      console.log("Venue Map ID:", map.id);
      console.log("Venue Map Layout Sections:", map.layout_json?.sections?.map(s => ({ key: s.key, label: s.label, tier_id: s.tier_id })));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
