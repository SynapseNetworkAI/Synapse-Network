const fs = require("fs");
let code = fs.readFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx", "utf8");

if (!code.includes("usePathname")) {
  code = code.replace(/import \{ useState, useEffect \} from "react";/, 'import { useState, useEffect } from "react";\nimport { usePathname } from "next/navigation";');
}

code = code.replace(/export default function Navbar\(\) \{/, `export default function Navbar() {\n  const pathname = usePathname();\n  const isHomePage = pathname === "/";\n`);

code = code.replace(/<div className="flex items-center">\s*<WalletProfileBadge \/>\s*<\/div>/, `{!isHomePage && (\n        <div className="flex items-center">\n          <WalletProfileBadge />\n        </div>\n      )}`);

fs.writeFileSync("/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx", code);
