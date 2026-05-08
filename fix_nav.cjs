const fs = require('fs');

const file = 'index.html';
let content = fs.readFileSync(file, 'utf8');

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

fs.writeFileSync(file, content, 'utf8');
console.log("Updated index.html");
