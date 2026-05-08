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
    
    // Replace sidebar image logo back to text
    const sidebarRegex = /<div class="ev-sidebar-brand" style="display:flex; align-items:center; gap:10px;">\s*<img src="images\/logo\.png"[^>]*>\s*<div style="display:flex; flex-direction:column; justify-content:center;">\s*<p style="margin:0; font-size:0\.8rem; color:#888;">(.*?)<\/p>\s*<\/div>\s*<\/div>/g;
    content = content.replace(sidebarRegex, `<div class="ev-sidebar-brand">\n      <h1 style="color: #2563EB;">Events<span>li</span></h1>\n      <p>$1</p>\n    </div>`);

    // Replace navbar/footer image logo back to text
    // The link looks like <a ... class="nav-logo"...><img ... /></a>
    // Let's replace the img inside .nav-logo with text.
    const navLogoRegex = /(<a[^>]*class="nav-logo"[^>]*>)\s*<img src="images\/logo\.png"[^>]*>\s*<\/a>/g;
    content = content.replace(navLogoRegex, `$1<span class="nav-logo-text" style="font-size:2rem; color: #2563EB; font-weight: 800;">Eventsli</span></a>`);

    // Just in case there are other img tags for logo.png
    content = content.replace(/<img src="images\/logo\.png"[^>]*>/g, `<span class="nav-logo-text" style="font-size:2rem; color: #2563EB; font-weight: 800;">Eventsli</span>`);

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Restored text logo in", file);
    }
});
