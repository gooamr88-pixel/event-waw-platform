import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read the credentials from src/lib/supabase.js
const supabaseFile = fs.readFileSync('c:\\Users\\yousef amr\\Desktop\\events platform\\src\\lib\\supabase.js', 'utf8');
const urlMatch = supabaseFile.match(/const supabaseUrl = '([^']+)';/);
const keyMatch = supabaseFile.match(/const supabaseAnonKey = '([^']+)';/);

if (!urlMatch || !keyMatch) {
  console.log("Could not find credentials");
  process.exit(1);
}

const supabase = createClient(urlMatch[1], keyMatch[1]);

async function run() {
  const { data, error } = await supabase.from('events').select('id, title, gallery_urls, sponsor_urls, created_at').order('created_at', { ascending: false }).limit(3);
  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
run();
