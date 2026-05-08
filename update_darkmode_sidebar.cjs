const fs = require('fs');
const file = 'css/eveenty-dashboard.css';
let content = fs.readFileSync(file, 'utf8');

// match the dark mode sidebar background
content = content.replace(
    /linear-gradient\(180deg,#1a1510 0%,#1e1812 40%,#151210 100%\)/g,
    'linear-gradient(180deg, #0f172a 0%, #020617 100%)'
);

fs.writeFileSync(file, content, 'utf8');
