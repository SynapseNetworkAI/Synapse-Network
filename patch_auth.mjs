import fs from 'fs';

let content = fs.readFileSync('/Users/cliff/workspace/A2A-pay/frontend/src/components/WalletAuthGuard.tsx', 'utf8');

// We want to clear verifiedWallet if address changes and doesn't match verifiedWallet.
const matchStr = `  useEffect(() => {
    if (!isConnected || !address) {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError(null);
      setIsAuthorizing(false);
      return;
    }`;

const insertStr = `  useEffect(() => {
    if (!isConnected || !address) {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError(null);
      setIsAuthorizing(false);
      return;
    }

    // Detect wallet address change (串号保护)
    if (verifiedWallet && address.toLowerCase() !== verifiedWallet.toLowerCase()) {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError("The wallet address has changed, please re-sign to synchronize sessions");
      setIsAuthorizing(false);
      return;
    }`;

content = content.replace(matchStr, insertStr);
fs.writeFileSync('/Users/cliff/workspace/A2A-pay/frontend/src/components/WalletAuthGuard.tsx', content);
console.log("Patched WalletAuthGuard.tsx");
