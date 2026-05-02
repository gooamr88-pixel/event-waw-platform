const fs = require('fs');
let lines = fs.readFileSync('js/eveenty-dashboard.js', 'utf8').split('\n');

const modules = {
  'dashboard-modals.js': {
    imports: "import { supabase, getCurrentUser } from './supabase.js';\nimport { createEvent, updateEvent } from './events.js';\nimport { escapeHTML } from './utils.js';\nimport { showToast, switchToPanel } from './dashboard-ui.js';\nimport { safeQuery } from './api.js';\nimport { loadDashboard } from '../js/eveenty-dashboard.js';\n",
    funcs: ['setupCreateModal', 'loadEventForEditing'],
    prependCode: "let pendingCoverFile = null;\n"
  },
  'dashboard-search.js': {
    imports: "import { escapeHTML } from './utils.js';\nimport { setSafeHTML } from './dom.js';\n",
    funcs: ['setupSearch']
  },
  'dashboard-calendar.js': {
    imports: "import { escapeHTML } from './utils.js';\nimport { setSafeHTML } from './dom.js';\n",
    funcs: ['setupCalendar', 'renderCalendar'],
    prependCode: "export let calMonth = new Date().getMonth();\nexport let calYear = new Date().getFullYear();\nexport let calEvents = [];\n"
  },
  'dashboard-attendees.js': {
    imports: "import { supabase, getCurrentUser } from './supabase.js';\nimport { showToast } from './dashboard-ui.js';\nimport { safeQuery } from './api.js';\n",
    funcs: ['setupEmailAttendees']
  },
  'dashboard-profile.js': {
    imports: "import { supabase, getCurrentUser, getCurrentProfile } from './supabase.js';\nimport { showToast } from './dashboard-ui.js';\nimport { safeQuery } from './api.js';\n",
    funcs: ['setupProfilePanel', 'setupUserDropdown']
  }
};

const linesToRemove = new Set();
const importNames = [];

for (const [filename, config] of Object.entries(modules)) {
  let fileContent = config.imports + '\n' + (config.prependCode || '');
  
  for (const fn of config.funcs) {
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
      
      let block = lines.slice(start, end + 1).join('\n');
      block = block.replace(/^(async )?function /m, 'export $1function ');
      fileContent += block + '\n\n';
      importNames.push({ name: fn, file: filename });
      
      for (let i = start; i <= end; i++) linesToRemove.add(i);
    }
  }
  fs.writeFileSync('src/lib/' + filename, fileContent);
}

// remove globals
const globalsToRemove = ['let tableListenerAttached', 'let approvalTabFilter', 'let vendorTableExists', 'let dashNotifications', 'let calMonth', 'let calYear', 'let calEvents', 'let pendingCoverFile'];
for(let i=0; i<lines.length; i++) {
  if (globalsToRemove.some(g => lines[i].startsWith(g))) {
    linesToRemove.add(i);
  }
}

let newLines = lines.filter((_, i) => !linesToRemove.has(i));

const importsCode = [
  ...new Set(importNames.map(n => n.file))
].map(file => {
  const funcs = importNames.filter(n => n.file === file).map(n => n.name).join(', ');
  return `import { ${funcs} } from '../src/lib/${file}';`;
}).join('\n');

const firstImportIndex = newLines.findIndex(l => l.startsWith('import '));
newLines.splice(firstImportIndex, 0, importsCode);

fs.writeFileSync('js/eveenty-dashboard.js', newLines.join('\n'));
console.log('Batch 3 Extraction complete.');
