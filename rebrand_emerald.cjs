const fs = require('fs');
const path = require('path');

const replacements = [
  // Hex replacements
  { from: /#2563EB/gi, to: '#059669' },
  { from: /#1D4ED8/gi, to: '#047857' },
  { from: /#1E40AF/gi, to: '#065F46' },
  { from: /#1E3A8A/gi, to: '#064E3B' },
  { from: /#60A5FA/gi, to: '#34D399' },
  { from: /#3B82F6/gi, to: '#10B981' },
  { from: /#4F46E5/gi, to: '#059669' },
  { from: /#3730A3/gi, to: '#064E3B' },
  { from: /#818CF8/gi, to: '#34D399' },
  { from: /#93C5FD/gi, to: '#6EE7B7' },

  // RGBA/RGB component replacements
  { from: /37,\s*99,\s*235/g, to: '5, 150, 105' },
  { from: /59,\s*130,\s*246/g, to: '16, 185, 129' },
  { from: /29,\s*78,\s*216/g, to: '4, 120, 87' },
  { from: /96,\s*165,\s*250/g, to: '52, 211, 153' }
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (['node_modules', '.git', 'images', 'fonts'].includes(file)) continue;
      processDirectory(fullPath);
    } else {
      if (/\.(css|html|js)$/i.test(file)) {
        let content = fs.readFileSync(fullPath, 'utf8');
        let modified = false;
        
        for (const { from, to } of replacements) {
          if (from.test(content)) {
            content = content.replace(from, to);
            modified = true;
          }
        }

        if (modified) {
          fs.writeFileSync(fullPath, content, 'utf8');
          console.log(`Updated ${fullPath}`);
        }
      }
    }
  }
}

processDirectory('.');
console.log('Rebranding complete!');
