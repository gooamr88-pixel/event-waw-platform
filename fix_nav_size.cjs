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
    let content = original;
    
    // Change height from 5rem to 3.5rem to fit navbar and ensure no text
    content = content.replace(
        /<img src="images\/logo\.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:5rem; (.*?)" \/>/g,
        `<img src="images/logo.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:3.5rem; $1" />`
    );

    // Just in case any spans were missed
    content = content.replace(
        /<img src="images\/logo\.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:3.5rem; (.*?)" \/>\s*<span class="nav-logo-text">Eventsli<\/span>/g,
        `<img src="images/logo.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:3.5rem; $1" />`
    );

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Adjusted logo size in", file);
    }
});
