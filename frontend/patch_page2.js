const fs = require('fs');
const path = '/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/secrets/page.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/catch \(err\) /g, "catch (err: any) ");

fs.writeFileSync(path, content);
