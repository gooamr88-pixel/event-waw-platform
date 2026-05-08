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
    let content = original.replace(/href="images\/favicon\.png"/g, 'href="images/favicon.svg"');
    content = content.replace(/src="images\/favicon\.png"/g, 'src="images/favicon.svg"');

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Restored favicon.svg in", file);
    }
});
