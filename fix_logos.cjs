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
let changedFiles = 0;

const inlineSvgNav = /<div class="nav-logo-icon">[\s\S]*?<\/svg><\/div>/g;
const imgNavLogo = `<img src="images/logo.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:2rem; width:auto; border-radius:4px;" />`;

const inlineSvgFooter = /<div class="nav-logo-icon" style="width:1.5rem;height:1.5rem">[\s\S]*?<\/svg><\/div>/g;
const imgFooterLogo = `<img src="images/logo.png" alt="Eventsli Logo" class="nav-logo-icon" style="height:1.5rem; width:auto; border-radius:4px;" />`;

const inlineSvgChat = /<div class="ev-chatbox-avatar">[\s\S]*?<\/svg>\s*<\/div>/g;
const imgChatLogo = `<div class="ev-chatbox-avatar"><img src="images/favicon.svg" alt="Eventsli" style="width:100%; height:100%; object-fit:contain; border-radius:50%;" /></div>`;

const sidebarBrandEventWaw = /<h1>Event <span>Waw<\/span><\/h1>/g;
const sidebarBrandEventsli = `<h1>Events<span>li</span></h1>`;

const sidebarBrandEventWawPlain = /<h1>Event Waw<\/h1>/g;

files.forEach(file => {
    const original = fs.readFileSync(file, 'utf8');
    let modified = original;
    
    modified = modified.replace(inlineSvgNav, imgNavLogo);
    modified = modified.replace(inlineSvgFooter, imgFooterLogo);
    modified = modified.replace(inlineSvgChat, imgChatLogo);
    modified = modified.replace(sidebarBrandEventWaw, sidebarBrandEventsli);
    modified = modified.replace(sidebarBrandEventWawPlain, sidebarBrandEventsli);

    if (original !== modified) {
        fs.writeFileSync(file, modified, 'utf8');
        console.log(`Updated logos in: ${file}`);
        changedFiles++;
    }
});

console.log(`Total HTML files updated with logos: ${changedFiles}`);
