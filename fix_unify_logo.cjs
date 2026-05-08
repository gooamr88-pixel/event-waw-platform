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
    
    // Replace text-based logo in sidebars with image logo and blue filter
    const textLogoRegex = /<div class="ev-sidebar-brand">\s*<h1>Events<span>li<\/span><\/h1>\s*<p>(.*?)<\/p>\s*<\/div>/g;
    const imageLogoHTML = `<div class="ev-sidebar-brand" style="display:flex; align-items:center; gap:10px;">
      <img src="images/logo.png" alt="Eventsli" style="height:2.8rem; width:auto; filter: hue-rotate(110deg) saturate(1.2) brightness(0.95);" />
      <div style="display:flex; flex-direction:column; justify-content:center;">
        <p style="margin:0; font-size:0.8rem; color:#888;">$1</p>
      </div>
    </div>`;
    content = content.replace(textLogoRegex, imageLogoHTML);

    // If an img tag doesn't have the filter, add it.
    // For logo.png
    content = content.replace(/(<img[^>]*src="images\/logo\.png"[^>]*style="[^"]*?)"([^>]*>)/g, (match, p1, p2) => {
        if (!p1.includes('hue-rotate')) {
            return `${p1} filter: hue-rotate(110deg) saturate(1.2) brightness(0.95);"${p2}`;
        }
        return match;
    });

    // For favicon.png
    content = content.replace(/(<img[^>]*src="images\/favicon\.png"[^>]*style="[^"]*?)"([^>]*>)/g, (match, p1, p2) => {
        if (!p1.includes('hue-rotate')) {
            return `${p1} filter: hue-rotate(110deg) saturate(1.2) brightness(0.95);"${p2}`;
        }
        return match;
    });

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Unified logo in", file);
    }
});
