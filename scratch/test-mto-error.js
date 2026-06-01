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

  console.log("🔍 Fetching any event in database...");
  const evRes = await fetch(`${supabaseUrl}/rest/v1/events?select=id,title,status,accepted_payment_methods,ticket_tiers(*)&limit=5`, { headers });
  const events = await evRes.json();

  if (!events || events.length === 0 || events.error) {
    console.error("❌ Error or no events found:", events);
    return;
  }

  // Find a published event if one exists, otherwise use the first event
  const event = events.find(e => e.status === 'published') || events[0];
  console.log("✅ Using Event:", event.title, `(${event.id})`, `Status: ${event.status}`);
  console.log("Accepted payment methods:", event.accepted_payment_methods);
  
  const tier = event.ticket_tiers && event.ticket_tiers[0];
  if (!tier) {
    console.error("❌ No ticket tiers found for this event!");
    return;
  }
  console.log("✅ Ticket Tier:", tier.name, `(${tier.id})`, `Price: ${tier.price}`);

  // Determine a valid manual payment method from accepted ones
  const manualMethod = (event.accepted_payment_methods || []).find(m => m !== 'stripe') || 'vodafone_cash';
  console.log(`🚀 Making request to create-manual-order using method: ${manualMethod}...`);

  const payload = {
    event_id: event.id,
    tier_id: tier.id,
    quantity: 1,
    payment_method: manualMethod,
    buyer_name: "Test Buyer",
    buyer_email: "testbuyer@gmail.com",
    buyer_phone: "+201012345678"
  };

  const functionUrl = `${supabaseUrl}/functions/v1/create-manual-order`;
  console.log("URL:", functionUrl);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log("Response Body:", text);
  } catch (err) {
    console.error("Request failed:", err);
  }
}

run();
