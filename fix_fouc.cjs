const fs = require('fs');
const file = 'index.html';
let content = fs.readFileSync(file, 'utf8');

// Replace the old style block
const oldStyle = `      /* Prevent FOUC for CMS content */
      body.cms-loading .ev-hero-text h1,
      body.cms-loading .ev-hero-text p,
      body.cms-loading .ev-partners-track,
      body.cms-loading .ev-stats-grid {
        opacity: 0;
        transform: translateY(10px);
      }
      .ev-hero-text h1,
      .ev-hero-text p,
      .ev-partners-track,
      .ev-stats-grid {
        transition: opacity 0.4s ease, transform 0.4s ease;
      }`;

const newStyle = `      /* Prevent FOUC for CMS content */
      body.cms-loading .ev-hero-split,
      body.cms-loading .ev-partners-track,
      body.cms-loading .ev-stats-grid {
        opacity: 0;
        transform: translateY(10px);
      }
      .ev-hero-split,
      .ev-partners-track,
      .ev-stats-grid {
        transition: opacity 0.4s ease, transform 0.4s ease;
      }`;

content = content.replace(oldStyle, newStyle);

fs.writeFileSync(file, content, 'utf8');
console.log("Updated FOUC prevention in index.html");
