const fs = require('fs');

['admin.html', 'dashboard.html'].forEach(file => {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        content = content.replace(/css\/eveenty-dashboard\.css\?v=[a-zA-Z0-9_]+/g, 'css/eveenty-dashboard.css?v=' + Date.now());
        content = content.replace(/css\/admin\.css\?v=[a-zA-Z0-9_]+/g, 'css/admin.css?v=' + Date.now());
        fs.writeFileSync(file, content, 'utf8');
        console.log("Cache busted in", file);
    }
});
