const fs = require('fs');

const dashboardCode = fs.readFileSync('js/eveenty-dashboard.js', 'utf8');
let lines = dashboardCode.split('\n');
let modalCode = fs.readFileSync('src/lib/dashboard-modals.js', 'utf8');

const funcsToExtract = [
  'resetCreateEventForm', 'initGooglePlacesAutocomplete', 'renderGoogleKeywords', 
  'showGoogleMapPreview', 'setupCeUpload', 'handleCeFileUpload', 'renderCeTicketsTable', 
  'updateCePreview', 'showEditModal', 'uploadCoverImage', 'uploadEventFile'
];

const linesToRemove = new Set();
const importNames = [];

for (const fn of funcsToExtract) {
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
    modalCode += block + '\n\n';
    importNames.push(fn);
    for (let i = start; i <= end; i++) linesToRemove.add(i);
  }
}

let newLines = lines.filter((_, i) => !linesToRemove.has(i));

// Add imports
if (importNames.length > 0) {
  const importsCode = `import { ${importNames.join(', ')} } from '../src/lib/dashboard-modals.js';`;
  const firstImportIndex = newLines.findIndex(l => l.startsWith('import '));
  newLines.splice(firstImportIndex, 0, importsCode);
}

fs.writeFileSync('src/lib/dashboard-modals.js', modalCode);
fs.writeFileSync('js/eveenty-dashboard.js', newLines.join('\n'));
console.log('Final extraction complete.');
