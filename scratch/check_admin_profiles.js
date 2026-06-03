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

  console.log("🔍 Fetching profiles with admin-level roles...");
  // Let's search for roles like admin, super_admin, moderator, or check recent profiles
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,full_name,role,is_blocked&limit=20`, { headers });
  const profiles = await res.json();

  if (res.status !== 200) {
    console.error("Error querying REST endpoint:", profiles);
    return;
  }

  console.log("📋 Profiles list:");
  profiles.forEach(p => {
    console.log(`- Name: ${p.full_name || 'N/A'}, Email: ${p.email || 'N/A'}, Role: ${p.role}, Blocked: ${p.is_blocked}`);
  });
}

run();
