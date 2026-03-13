const fs = require("fs");
let code = fs.readFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx", "utf8");

code = code.replace(/\{\/\* Wallet profile is now conditionally removed[\s\S]*?\n\s*\{!isHomePage && \(\n\s*\{!isHomePage && \(\n\s*<div className="flex items-center">\n\s*<WalletProfileBadge \/>\n\s*<\/div>\n\s*\)\}\n\s*\)\}/, 
`{/* Wallet profile is conditionally removed on the home page */}
      {!isHomePage && (
        <div className="flex items-center">
          <WalletProfileBadge />
        </div>
      )}`);

fs.writeFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx", code);
