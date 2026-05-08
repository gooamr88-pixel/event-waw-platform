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
    let modified = original.replace(/favicon\.svg/g, 'favicon.png');

    if (original !== modified) {
        fs.writeFileSync(file, modified, 'utf8');
    }
});

console.log("Updated favicon.svg to favicon.png");
