const fs = require("fs");
let code = fs.readFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/app/page.tsx", "utf8");

const oldCode = `if (!address || role === 'ADMIN') {
      executeRoute(role, path);
      return;
    }`;

const newCode = `if (role === 'ADMIN') {
      executeRoute(role, path);
      return;
    }
    
    if (!address) {
      if (openConnectModal) {
        openConnectModal();
      }
      return;
    }`;

code = code.replace(oldCode, newCode);
fs.writeFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/app/page.tsx", code);
