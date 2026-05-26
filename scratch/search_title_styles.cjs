const fs = require('fs');

const content = fs.readFileSync('event-detail.html', 'utf8');
const lines = content.split('\n');
const matches = [];

lines.forEach((line, idx) => {
  if (line.includes('<h1') || line.includes('class="event-title"') || line.includes('class="title"') || line.includes('id="event-title"')) {
    matches.push(`${idx + 1}: ${line.trim()}`);
  }
});

console.log(matches);
