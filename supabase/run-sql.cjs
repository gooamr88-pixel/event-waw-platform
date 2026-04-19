const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.argv[2];
const sqlFile = process.argv[3];

if (!connectionString || !sqlFile) {
  console.error('Usage: node run-sql.cjs "connection-string" "file.sql"');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected');
    const sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
    await client.query(sql);
    console.log('SQL executed successfully');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
