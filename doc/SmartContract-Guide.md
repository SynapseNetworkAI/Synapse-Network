# AgentPay 智能合约与测试指南

目前系统通过 Hardhat 框架完整实现了“AI 免密支付”、“防跑飞限额”以及“去中心化担保与抽水”的本地测试验证。

## 1. 核心合约解析

我们的核心机制位于 `contracts/` 目录下，由两个核心合约交织构成：

### 合约一：`AgentPayEscrow.sol` (大动脉与吸金黑洞)
这个合约就是我们的“去中心化支付宝担保站”以及平台的变现机器。

- **`lockFunds(bytes32 taskId, address seller, uint256 amount)`**：买方 Agent 拿着预算过来告诉合约我要买数据。合约瞬间把这笔资金锁定，并发送广播凭条。
- **`releaseFunds(bytes32 taskId)`**：买卖双方验收完毕，这一步是整个系统的商业模式核心：
  - 抽水逻辑已写死：` feeAmount = (task.totalAmount * feeBasisPoints) / DENOMINATOR; ` (2.5%的平台服务费)
  - 在微秒级别，97.5% 打进卖方账户，2.5% 无声无息滑入我们预设的 `treasury`（平台国库钱包）。

### 合约二：`AgentSmartWallet.sol` (限流阀与 Session Key)
用于实现在保证资金绝对安全的前提下，让 AI 可以脱离人类确认进行高频调用。

- **`issueSessionKey(address _sessionKey, uint256 _dailyLimit)`**：防暴走开关。人类老板授权一个专属于该 AI 的私钥（Session Key）并设定每日开销上限（例如 10 USD）。
- **`executeAsAgent(address target, bytes calldata data, uint256 amount)`**：AI 想要花钱时经过的关卡。
  - **防跑飞墙**: `require(spentToday + amount <= dailyLimit, "Agent exceeded daily limit! Boss is angry.");`
  - 如果被黑客盗取了这把放在 Python `.env` 中的 Key，单日损失也将被死死卡在设定限额之内，永远碰不到老板在合约里的原始主金库。

---

## 2. 如何自己跑一遍本地仿真测试？

所有的测试逻辑使用 Hardhat 和 Ethers.js 编写，模拟了多角色的互助流程：
1. **角色分配**: 人类老板(`owner`)，平台国库(`treasury`)，打工AI买方(`aiBuyer`)，打工AI卖方(`aiSeller`)。
2. **场景**:
   - 老板充值并为买方AI发放了每日 10 USDT 的许可。
   - 买方AI通过“原子担保交易”花 2 USDT 购买数据。
   - 释放资金，AI卖家收入 1.95 USDT，咱们平台进账 0.05 USDT！
   - 买方AI试图贪污花超每日限额报错被拦截。

### 运行步骤：

**环境要求：** 必须使用 `Node.js 18+`，已准备好包含 Hardhat 本地依赖的包。

在项目根目录 `/Users/cliff/workspace/A2A-pay` 打开终端，直接运行：

```bash
npx hardhat test
```

### 预期超爽结果：
看到下面这四排绿灯，说明“赛博机器经济”的第一步大基建已经在你的本地电脑跑通了：

```text
🤖 AgentPay Protocol MVP - 机器经济实盘推演
  ✔ Step 1: 老板为 AI 颁发 Session Key 并设置每日 10 USDC 额度
  ✔ Step 2: AI 使用 Session Key 免密发起购买 (原子级担保交易)

     💰 [财务报表]
     卖方 Agent 入账: 1.95 USDC
     咱们平台抽水入账: 0.05 USDC

  ✔ Step 3: 卖方交货，AI 释放资金，平台无情抽走 2.5% 利润
  ✔ Step 4: AI 尝试背叛老板超额消费，被智能合约直接击毙 (防暴走测试)

4 passing
```

---

## 3. 接下来的研发流
目前底层金融逻辑畅通，下半场的重心将围绕在**“造福 AI 开发者”**：
1. **编写 Python SDK (`pip install agentpay`)**：用 Python 包装这套复杂的 EVM 调用，使得开发者只需要用两行代码 `agent.pay(target="agent_b", amount=2)`。
2. **Next.js 控制台**：做一个可视化的黑客帝国风展示板，让人类老板看着数字跳动。
