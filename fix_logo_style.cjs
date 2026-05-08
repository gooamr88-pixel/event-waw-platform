const fs = require('fs');
const path = require('path');

const allowedExts = ['.html'];
const ignoreDirs = ['node_modules', '.git'];

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            if (!ignoreDirs.some(i => file.includes(i))) {
                results = results.concat(walk(file));
            }
        } else {
            const ext = path.extname(file);
            if (allowedExts.includes(ext)) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('.');

files.forEach(file => {
    const original = fs.readFileSync(file, 'utf8');
    
    // Update main nav logo (height from 2rem to 3.2rem, add hue-rotate)
    let modified = original.replace(
        /style="height:2rem;\s*width:auto;\s*border-radius:4px;"/g, 
        'style="height:3.2rem; width:auto; border-radius:4px; filter: hue-rotate(110deg) saturate(1.2) brightness(0.95); margin-top: -6px;"'
    );
    
    // Update footer logo (height from 1.5rem to 2.2rem, add hue-rotate)
    modified = modified.replace(
        /style="height:1.5rem;\s*width:auto;\s*border-radius:4px;"/g, 
        'style="height:2.2rem; width:auto; border-radius:4px; filter: hue-rotate(110deg) saturate(1.2) brightness(0.95);"'
    );
    
    // Update chatbox logo (add hue-rotate)
    modified = modified.replace(
        /style="width:100%;\s*height:100%;\s*object-fit:contain;\s*border-radius:50%;"/g, 
        'style="width:100%; height:100%; object-fit:contain; border-radius:50%; filter: hue-rotate(110deg) saturate(1.2) brightness(0.95);"'
    );

    if (original !== modified) {
        fs.writeFileSync(file, modified, 'utf8');
        console.log(`Updated sizes and colors in: ${file}`);
    }
});
