const fs = require('fs');

const file = 'src/lib/dashboard-modals.js';
let content = fs.readFileSync(file, 'utf8');

// The emojis to remove or replace
const emojis = [
  '🗑️', '💾', '🚀', '✕', '📍', '✏️', '🟢', '📝'
];

emojis.forEach(e => {
  content = content.split(e).join('');
});

// also general non-ascii replace just in case, but let's be careful
let stripped = '';
for (let i = 0; i < content.length; i++) {
  const cc = content.charCodeAt(i);
  // Allow ASCII, and simple quotes, but strip true emojis
  // Emojis are typically > 10000
  if (cc > 10000) {
    continue;
  }
  stripped += content[i];
}

fs.writeFileSync(file, stripped, 'utf8');
console.log('Stripped emojis from dashboard-modals.js');
