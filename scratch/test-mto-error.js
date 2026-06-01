import fs from 'fs';

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

  console.log("🔍 Querying events and ticket_tiers currencies...");
  const evRes = await fetch(`${supabaseUrl}/rest/v1/events?select=id,title,status,currency,ticket_tiers(id,name,price,currency)&limit=5`, { headers });
  const events = await evRes.json();

  console.log("Database Response:", JSON.stringify(events, null, 2));
}

run();
