/**
 * EVENT WAW — Run v5 Full Migration
 * 
 * Bypasses the Supabase SQL Editor parser bug by connecting
 * directly to PostgreSQL via the `pg` package.
 * 
 * Runs:
 *   1. Guest functions (clean PL/pgSQL — no EXECUTE workarounds)
 *   2. Full migration (schema + RLS + financial RPCs)
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.argv[2];

if (!connectionString) {
  console.error('\n❌ Usage: node run-migration.js "postgresql://..."');
  process.exit(1);
}

// Files to run IN ORDER
const migrationFiles = [
  { file: 'migration-v5-guest-checkout-rls.sql', label: 'Full v5 migration (schema + functions + RLS + RPCs)' },
  { file: 'migration-v5-part2-functions.sql', label: 'Clean guest functions (replaces EXECUTE-based versions)' },
];

async function run() {
  console.log('🔌 Connecting to database...');
  
  const client = new Client({ 
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected!\n');

    for (const { file, label } of migrationFiles) {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  Skipping ${file} (not found)`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`🚀 Running: ${label}...`);
      await client.query(sql);
      console.log(`   ✅ Done!\n`);
    }
    
    // Verify functions
    const funcs = await client.query(`
      SELECT proname, pg_get_function_result(oid) as returns
      FROM pg_proc
      WHERE proname IN ('create_guest_reservation', 'create_guest_token', 'verify_guest_token',
                        'get_organizer_revenue', 'get_event_tier_revenue', 'get_daily_revenue')
      ORDER BY proname
    `);
    
    console.log('📋 Verified functions:');
    funcs.rows.forEach(r => console.log(`   ✓ ${r.proname}() → ${r.returns}`));
    
    // Verify RLS policies
    const policies = await client.query(`
      SELECT tablename, COUNT(*) as policy_count
      FROM pg_policies WHERE schemaname = 'public'
      GROUP BY tablename ORDER BY tablename
    `);
    
    console.log('\n🔒 RLS policies per table:');
    policies.rows.forEach(r => console.log(`   ✓ ${r.tablename}: ${r.policy_count} policies`));
    
    console.log('\n✅ All migrations complete!');
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    if (err.hint) console.error('   Hint:', err.hint);
    if (err.position) console.error('   Position:', err.position);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
