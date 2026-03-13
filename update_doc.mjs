import fs from 'fs';
const docPath = '../doc/feature_designs/role_isolation_frontend_design.md';
let content = fs.readFileSync(docPath, 'utf8');

const newSection = `
## 7. 架构决策: 统一钱包双重角色与软级拦截 (Soft Nudge)

### 7.1 核心理念: Dumb Vault 与自由切换
根据 Synapse Network 的“Dumb Vault”哲学，智能合约和后端数据库**绝对不**对地址的“单一角色”做强制绑定。
*   **Web3 自由意志**：一个 0x 地址天然有权同时作为“调用者(Buyer)”和“服务提供方(Seller)”。
*   **消除后端沉余**：数据库不再需要冗余的 \`Role\` 字段，一切权限验证回归于：“有没有钱”、“有没有签名的Key”、“有没有上架Service”。

### 7.2 业务痛点: 安全爆炸半径与对账混乱
虽然底层允许双持角色，但在实际业务中如果混用同一个地址：
1. **资金池（Vault）混记**：卖家赚到的利润和买家充值进来的消费金混在同一个 Vault Balance 中，财务报表根本算不清（对账灾难）。
2. **安全爆炸半径**：卖家节点可能需要暴露一定的密钥给外部网关环境，如果用同一个主钱包做买家（里面存了大量余额），一旦节点被渗透，买家的充值金也会面临更大风险。

### 7.3 设计范式: 前端软阻断模式 (Soft Warning Modal)
因此，系统在且仅在前端部署**跨角色操作拦截器（Soft Nudge）**：
*   **场景**：
    *   当一个已有买家记录（拥有 API Key 或调用历史）的用户，尝试点击 \`[Deploy/Register Service]\` 成为卖家时。
    *   当一个已有卖家记录（拥有 Service Manifest）的用户，尝试点击 \`[Create API Key]\` 充当买家时。
*   **交互表现 (UX)**：弹出醒目的黄底黑字 **"⚠️ Architecture Warning: Mixed Wallet Usage"**。
*   **文案解释**：“系统检测您正试图在同一个地址上混合使用Buyer和Seller职能。这可能导致您的消费账单与收入账单混杂，且扩大凭证泄漏的安全爆炸半径。”
*   **免责确认**：提供两个按钮：
    *   \`[Cancel & Switch Wallet]\` (推荐安全做法)
    *   \`[I Know What I am Doing - Proceed]\` (开发者免责继续)
这种设计完美平衡了“Web3极客自由”与“金融级SaaS严谨”。
`;

let i = content.indexOf('## 7. 架构决策');
if (i !== -1) {
  content = content.substring(0, i);
}

fs.writeFileSync(docPath, content + newSection);
console.log('Fixed doc');
