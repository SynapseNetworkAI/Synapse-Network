const fs = require('fs');
const path = '/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/secrets/page.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/catch \(err: any\)/g, "catch (error)");
content = content.replace(/\$\{err\?\.message \|\| err\}/g, "${error instanceof Error ? error.message : String(error)}");

fs.writeFileSync(path, content);
