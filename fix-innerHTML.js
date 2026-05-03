const fs = require('fs');
let code = fs.readFileSync('src/lib/dashboard-modals.js', 'utf8');
let lines = code.split('\n');
let changed = 0;

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // Skip comments
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
  
  // Pattern 1: element.innerHTML = 'static string';
  let m = line.match(/^(\s*)(\S+?)\.innerHTML\s*=\s*('.*?';)$/);
  if (m) {
    lines[i] = m[1] + 'setSafeHTML(' + m[2] + ', ' + m[3].slice(0, -1) + ');';
    changed++;
    continue;
  }
  
  // Pattern 2: element.innerHTML = '';
  m = line.match(/^(\s*)(.+?)\.innerHTML\s*=\s*'';?$/);
  if (m) {
    lines[i] = m[1] + m[2] + ".textContent = '';";
    changed++;
    continue;
  }
  
  // Pattern 3: element.innerHTML = `template`;  (single line ending with `;)
  m = line.match(/^(\s*)(\S+?)\.innerHTML\s*=\s*(`.*?`;)$/);
  if (m) {
    lines[i] = m[1] + 'setSafeHTML(' + m[2] + ', ' + m[3].slice(0, -1) + ');';
    changed++;
    continue;
  }
  
  // Pattern 4: if (el) el.innerHTML = 'string';
  m = line.match(/^(\s*if\s*\(.+?\)\s*)(\S+?)\.innerHTML\s*=\s*('.*?';)$/);
  if (m) {
    lines[i] = m[1] + 'setSafeHTML(' + m[2] + ', ' + m[3].slice(0, -1) + ');';
    changed++;
    continue;
  }
  
  // Pattern 5: if (el) el.innerHTML = `template`;
  m = line.match(/^(\s*if\s*\(.+?\)\s*)(\S+?)\.innerHTML\s*=\s*(`.*?`;)$/);
  if (m) {
    lines[i] = m[1] + 'setSafeHTML(' + m[2] + ', ' + m[3].slice(0, -1) + ');';
    changed++;
    continue;
  }
  
  // Pattern 6: btn.innerHTML = expr ? 'a' : 'b';  (ternary on same line)
  m = line.match(/^(\s*)(\S+?)\.innerHTML\s*=\s*(.*\?.*:.*';?)$/);
  if (m) {
    let val = m[3];
    if (val.endsWith(';')) val = val.slice(0, -1);
    lines[i] = m[1] + 'setSafeHTML(' + m[2] + ', ' + val + ');';
    changed++;
    continue;
  }
  
  // Pattern 7: Multi-line innerHTML = something.map( ... (look for closing on a later line)
  m = line.match(/^(\s*)(\S+?)\.innerHTML\s*=\s*(.+\.map\(.*)$/);
  if (m && !line.endsWith(';')) {
    // Find the closing line (ends with .join('');  or  ).join('');)
    let closeLine = -1;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      if (lines[j].trim().match(/\)\.join\(.*\);?$/)) {
        closeLine = j;
        break;
      }
    }
    if (closeLine > 0) {
      lines[i] = m[1] + 'setSafeHTML(' + m[2] + ', ' + m[3];
      let closeContent = lines[closeLine].trimEnd();
      if (closeContent.endsWith(';')) closeContent = closeContent.slice(0, -1);
      lines[closeLine] = closeContent + ');';
      changed++;
      continue;
    }
  }
  
  // Pattern 8: if (x) x.innerHTML = `multi-line  (starts template, ends later with `; )
  m = line.match(/^(\s*if\s*\(.+?\)\s*)(\S+?)\.innerHTML\s*=\s*(`.*$)/);
  if (m && !line.endsWith(';')) {
    let closeLine = -1;
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
      if (lines[j].trim().match(/`;?\s*$/)) {
        closeLine = j;
        break;
      }
    }
    if (closeLine > 0) {
      lines[i] = m[1] + 'setSafeHTML(' + m[2] + ', ' + m[3];
      let closeContent = lines[closeLine].trimEnd();
      if (closeContent.endsWith(';')) closeContent = closeContent.slice(0, -1);
      lines[closeLine] = closeContent + ');';
      changed++;
      continue;
    }
  }
}

fs.writeFileSync('src/lib/dashboard-modals.js', lines.join('\n'), 'utf8');
console.log('Replaced ' + changed + ' innerHTML patterns');
