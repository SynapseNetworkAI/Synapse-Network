import fs from 'fs';

let content = fs.readFileSync('/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx', 'utf8');
content = content.replace('import { ConnectButton } from "@rainbow-me/rainbowkit";', '');
content = content.replace(/<div className="flex items-center space-x-4">\s*<ConnectButton \/>\s*<\/div>/g, '');
fs.writeFileSync('/Users/cliff/workspace/A2A-pay/frontend/src/components/Navbar.tsx', content);
console.log("Patched Navbar");
