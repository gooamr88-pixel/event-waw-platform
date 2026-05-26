const fs = require('fs');

const content = fs.readFileSync('event-detail.html', 'utf8');
const lines = content.split('\n');
const matches = [];

lines.forEach((line, idx) => {
  if (line.includes('event-detail-hero') || line.includes('event-hero-content') || line.includes('detail-hero')) {
    matches.push(`${idx + 1}: ${line.trim()}`);
  }
});

console.log(matches);
