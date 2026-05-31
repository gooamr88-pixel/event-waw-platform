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
    const profiles = await callSupabase('profiles', '?select=id,email,full_name,role');
    console.log("Profiles:", profiles);

    const events = await callSupabase('events', '?select=id,title,organizer_id,status');
    console.log("Events:", events);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
