const fs = require('fs');
const path = '/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/secrets/page.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/toast\.error\(err\.message \|\| 'Failed to load secrets'\);/g, "toast.error(`LOAD ERROR: ${err?.message || err} | stack: ${err?.stack?.split('\\n')[0]}`);");
content = content.replace(/toast\.error\(err\.message \|\| 'Failed to create secret'\);/g, "toast.error(`CREATE ERROR: ${err?.message || err} | stack: ${err?.stack?.split('\\n')[0]}`);");
content = content.replace(/toast\.error\("Failed to load secrets"\);/g, "toast.error(`ALERT LOAD ERROR: ${err?.message || err}`);");
content = content.replace(/toast\.error\("Failed to create secret"\);/g, "toast.error(`ALERT CREATE ERROR: ${err?.message || err}`);");

fs.writeFileSync(path, content);
