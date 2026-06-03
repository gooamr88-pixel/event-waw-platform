import fs from 'fs';

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
    const eventId = 'c526ab62-11d3-4364-8683-d81f6a4cbb7c';

    // 1. Get event organizer_id
    const events = await callSupabase('events', `?select=id,title,organizer_id&id=eq.${eventId}`);
    if (!events || events.length === 0) {
      console.log("Event not found");
      return;
    }
    const event = events[0];
    console.log(`Event: "${event.title}", Organizer ID: ${event.organizer_id}`);

    // 2. Get current platform terms version
    const termsVersions = await callSupabase('platform_terms_versions', '?select=version_code,is_current,terms_type&is_current=eq.true&terms_type=eq.platform');
    console.log("Current Platform Terms Versions:", termsVersions);
    if (!termsVersions || termsVersions.length === 0) {
      console.log("No current platform terms version found!");
      return;
    }
    const currentVersion = termsVersions[0].version_code;

    // 3. Get acceptances for this organizer
    const acceptances = await callSupabase('terms_acceptances', `?select=*&user_id=eq.${event.organizer_id}`);
    console.log(`Terms acceptances for organizer ${event.organizer_id}:`, acceptances);

    // 4. Get organizer profile cache
    const organizers = await callSupabase('organizers', `?select=*&user_id=eq.${event.organizer_id}`);
    console.log(`Organizer profile in "organizers" table:`, organizers);

  } catch (err) {
    console.error("Error:", err);
  }
}
run();
