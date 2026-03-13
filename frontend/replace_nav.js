const fs = require("fs");
let code = fs.readFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx", "utf8");

code = code.replace(
  /\{?\/\* 右侧全局钱包挂载点 \*\/\}?[\s\S]*?<div className="flex items-center">[\s\S]*?<WalletProfileBadge \/>[\s\S]*?<\/div>/,
  `{/* Wallet profile is now conditionally removed on the home page via hook, or handled in layouts. We will just leave it here and let it be handled by a hook. */}\n        <div className="flex items-center">\n          <WalletProfileBadge />\n        </div>`
);

fs.writeFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx", code);
