const fs = require('fs');
let lines = fs.readFileSync('js/eveenty-dashboard.js', 'utf8').split('\n');

const funcsToRemove = [
  'showToast', 'setupUserInfo', 'setupSignOut', 'switchToPanel', 'setupSidebar', 'animateCounter', 'setupDarkMode',
  'renderEventsTable', 'calcRevenue', 'handleTableAction', 'duplicateEvent', 'populateEventSelects',
  'setupTicketsPanel', 'fetchDashboardStats'
];

const linesToRemove = new Set();
let firstImportIndex = -1;

for (const fn of funcsToRemove) {
  let start = -1;
  for(let i=0; i<lines.length; i++) {
    if (lines[i].startsWith('function ' + fn) || lines[i].startsWith('async function ' + fn)) {
      start = i; break;
    }
  }
  if (start !== -1) {
    let end = -1;
    let braceCount = 0;
    for(let i=start; i<lines.length; i++) {
      if (lines[i].includes('{')) braceCount += (lines[i].match(/\{/g) || []).length;
      if (lines[i].includes('}')) braceCount -= (lines[i].match(/\}/g) || []).length;
      if (braceCount === 0 && i > start) {
        end = i; break;
      }
    }
    for (let i = start; i <= end; i++) linesToRemove.add(i);
  }
}

let newLines = lines.filter((_, i) => !linesToRemove.has(i));

fs.writeFileSync('js/eveenty-dashboard.js', newLines.join('\n'));
console.log('Cleanup complete.');
