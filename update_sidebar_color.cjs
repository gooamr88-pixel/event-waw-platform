const fs = require('fs');
const file = 'css/eveenty-dashboard.css';
const content = fs.readFileSync(file, 'utf8');

// match the exact sidebar background
let modified = content.replace(
    /linear-gradient\(180deg,#60A5FA 0%,#2563EB 40%,#1D4ED8 100%\)/g,
    'linear-gradient(180deg, #1e3a8a 0%, #0f172a 100%)'
);

// match footer link colors
modified = modified.replace(
    /color:rgba\(0,0,0,\.6\)/g,
    'color:rgba(255,255,255,.6)'
);

modified = modified.replace(
    /color:rgba\(0,0,0,\.85\)/g,
    'color:rgba(255,255,255,.9)'
);

// We should also check for nav items. Let's see if there are any black colors in sidebar-nav
modified = modified.replace(
    /\.ev-sidebar-nav a\{([^\}]*?)color:(?:#000|rgba\(0,0,0,.*?)\}/g,
    (match) => {
        return match.replace(/color:(?:#000|rgba\(0,0,0,.*?\))/, 'color:rgba(255,255,255,.7)');
    }
);

if (content !== modified) {
    fs.writeFileSync(file, modified, 'utf8');
    console.log("Updated css");
} else {
    console.log("No changes made");
}
