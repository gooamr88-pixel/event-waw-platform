const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) walkDir(dirPath, callback);
    else callback(dirPath);
  });
}

const filesToFix = [];
['js', 'src/lib'].forEach(dir => {
  if (fs.existsSync(dir)) walkDir(dir, f => {
    if (f.endsWith('.js')) filesToFix.push(f);
  });
});

let innerHtmlReplaced = 0;

filesToFix.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  // Replace innerHTML with setSafeHTML
  // We use a regex that captures "variable.innerHTML = value"
  // but we must be careful with multiline or complex assignments.
  
  // First, handle simple empty string
  content = content.replace(/\.innerHTML\s*=\s*['"]['"]/g, ".textContent = ''");
  
  // Handle literal texts
  content = content.replace(/\.innerHTML\s*=\s*'([^'<]+)'/g, ".textContent = '$1'");
  
  // For other innerHTML assignments, we wrap them in setSafeHTML
  // A naive approach: find .innerHTML = ...;
  // This is tricky for multiline templates. Instead of fully parsing, we can just replace the left side if it's a simple identifier.
  const regex = /([a-zA-Z0-9_\.\?\-]+)\.innerHTML\s*=\s*([^;]+);/g;
  content = content.replace(regex, (match, left, right) => {
    if (right.trim().startsWith("''") || right.trim().startsWith('""') && right.trim().length === 2) {
      return `${left}.textContent = '';`;
    }
    innerHtmlReplaced++;
    return `setSafeHTML(${left}, ${right});`;
  });
  
  // Check if we injected setSafeHTML but didn't import it
  if (content !== originalContent && content.includes('setSafeHTML(') && !content.includes('import { setSafeHTML }') && !content.includes('import {') && !filePath.includes('dom.js')) {
    // Need to add import
    const depth = filePath.includes('src\\lib') || filePath.includes('src/lib') ? './' : '../src/lib/';
    const importStmt = `import { setSafeHTML } from '${depth}dom.js';\n`;
    
    // Find last import
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for(let i=0; i<lines.length; i++){
      if(lines[i].startsWith('import ')) lastImportIdx = i;
    }
    if (lastImportIdx !== -1) {
      lines.splice(lastImportIdx + 1, 0, importStmt);
    } else {
      lines.unshift(importStmt);
    }
    content = lines.join('\n');
  }

  // Also replace any specific things we know
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    console.log(`Fixed innerHTML in ${filePath}`);
  }
});

console.log(`Total innerHTML replacements: ${innerHtmlReplaced}`);
