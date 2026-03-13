const fs = require('fs');
const path = '/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/secrets/page.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/catch \(error\)/g, "catch (error: unknown)");
content = content.replace(/console\.error\('ERROR Loading secrets:', err\);/g, "console.error('ERROR Loading secrets:', error);");

fs.writeFileSync(path, content);
