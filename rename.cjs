const fs = require('fs');
const path = require('path');

const replacements = [
    { regex: /Event Waw/g, replace: 'Eventsli' },
    { regex: /EventWaw/g, replace: 'Eventsli' },
    { regex: /Eventwaw/g, replace: 'Eventsli' },
    { regex: /eventwaw\.com/g, replace: 'eventsli.com' },
    { regex: /eventwaw/g, replace: 'eventsli' }
];

const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.gemini'];
const allowedExts = ['.html', '.js', '.ts', '.css', '.json', '.md'];

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
let changedFiles = 0;

files.forEach(file => {
    const original = fs.readFileSync(file, 'utf8');
    let modified = original;
    
    replacements.forEach(({regex, replace}) => {
        modified = modified.replace(regex, replace);
    });

    if (original !== modified) {
        fs.writeFileSync(file, modified, 'utf8');
        console.log(`Updated: ${file}`);
        changedFiles++;
    }
});

console.log(`Total files modified: ${changedFiles}`);
