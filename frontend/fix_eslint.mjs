const fs = require('fs');

const consolePath = '/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/console/page.tsx';
let content = fs.readFileSync(consolePath, 'utf8');

content = content.replace('const { isLoading: isMintingTx } = useWaitForTransactionReceipt({ hash: mintTxHash });', '// eslint-disable-next-line @typescript-eslint/no-unused-vars\n  const { isLoading: isMintingTx } = useWaitForTransactionReceipt({ hash: mintTxHash });');

fs.writeFileSync(consolePath, content);
console.log('Fixed linting error');
