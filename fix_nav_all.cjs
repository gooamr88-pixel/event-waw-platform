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
    if (file.includes('index.html')) return;
    
    const original = fs.readFileSync(file, 'utf8');
    let content = original;
    
    // Navbar
    content = content.replace(
        /<img src="images\/logo\.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:[\d.]+rem; (.*?)" \/>\s*<span class="nav-logo-text">Eventsli<\/span>/g,
        `<img src="images/logo.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:5rem; $1" />`
    );

    // Footer
    content = content.replace(
        /<img src="images\/logo\.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:[\d.]+rem; (.*?)" \/>\s*<span class="nav-logo-text" style="font-size:1rem">Eventsli<span class="text-gold">\.<\/span><\/span>/g,
        `<img src="images/logo.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:3rem; $1" />`
    );

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Updated", file);
    }
});
