import fs from 'fs';

// Read the credentials from src/lib/supabase.js
const supabaseFile = fs.readFileSync('./src/lib/supabase.js', 'utf8');
const urlMatch = supabaseFile.match(/const supabaseUrl = '([^']+)';/);
const keyMatch = supabaseFile.match(/const supabaseAnonKey = '([^']+)';/);

if (!urlMatch || !keyMatch) {
  console.log("Could not find credentials");
  process.exit(1);
}

const supabaseUrl = urlMatch[1];
const supabaseAnonKey = keyMatch[1];

async function run() {
  const headers = {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'application/json'
  };

  console.log("🔍 Fetching event...");
  const evRes = await fetch(`${supabaseUrl}/rest/v1/events?title=ilike.*Amr%20Diab*&select=id,title,organizer_id&limit=1`, { headers });
  const events = await evRes.json();

  if (!events || events.length === 0) {
    console.error("Event not found");
    return;
  }

  const event = events[0];
  console.log("Event details:", event);

  console.log("🔍 Fetching organizer settings (organizers table)...");
  const orgRes = await fetch(`${supabaseUrl}/rest/v1/organizers?user_id=eq.${event.organizer_id}&select=*`, { headers });
  const organizers = await orgRes.json();

  console.log("Organizer Settings (organizers table):", organizers);
}

run();
