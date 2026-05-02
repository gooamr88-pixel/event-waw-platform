const fs = require('fs');
let lines = fs.readFileSync('js/eveenty-dashboard.js', 'utf8').split('\n');

const modules = {
  'dashboard-analytics.js': {
    imports: "import { supabase, getCurrentUser } from './supabase.js';\nimport { safeQuery } from './api.js';\nimport { escapeHTML } from './utils.js';\nimport { setSafeHTML } from './dom.js';\nimport { dashboardState } from './state.js';\n",
    ranges: [[2008, 2011], [2013, 2055], [534, 547], [468, 529]],
    prependCode: "let revenueChartInstance = null, tierChartInstance = null;\n"
  },
  'dashboard-vendors.js': {
    imports: "import { supabase } from './supabase.js';\nimport { safeQuery } from './api.js';\nimport { escapeHTML } from './utils.js';\nimport { setSafeHTML } from './dom.js';\n",
    ranges: [[1818, 1831], [1835, 1884]],
    prependCode: "let vendorTableExists = null;\nlet approvalTabFilter = 'pending';\n"
  },
  'dashboard-promos.js': {
    imports: "import { supabase, getCurrentUser } from './supabase.js';\nimport { safeQuery } from './api.js';\nimport { escapeHTML } from './utils.js';\nimport { setSafeHTML } from './dom.js';\nimport { showToast } from './dashboard-ui.js';\nimport { dashboardState } from './state.js';\n",
    ranges: [[1889, 1943], [1945, 2003]]
  },
  'dashboard-payout.js': {
    imports: "import { supabase, getCurrentUser } from './supabase.js';\nimport { showToast } from './dashboard-ui.js';\n",
    ranges: [[2060, 2101], [2103, 2122]]
  },
  'dashboard-notifications.js': {
    imports: "import { supabase, getCurrentUser } from './supabase.js';\nimport { escapeHTML } from './utils.js';\nimport { setSafeHTML } from './dom.js';\n",
    ranges: [[2142, 2166], [2168, 2221], [2223, 2255], [2257, 2266]],
    prependCode: "let dashNotifications = [];\n"
  }
};

const linesToRemove = new Set();
const importNames = [];

for (const [filename, config] of Object.entries(modules)) {
  let fileContent = config.imports + '\n' + (config.prependCode || '');
  for (const [start, end] of config.ranges) {
    let block = lines.slice(start, end + 1).join('\n');
    block = block.replace(/^(async )?function /m, 'export $1function ');
    fileContent += block + '\n\n';
    
    const match = block.match(/export (?:async )?function ([a-zA-Z0-9_]+)/);
    if (match) importNames.push({ name: match[1], file: filename });
    
    for (let i = start; i <= end; i++) linesToRemove.add(i);
  }
  fs.writeFileSync('src/lib/' + filename, fileContent);
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
console.log('Extraction complete. Files written and eveenty-dashboard.js updated.');
