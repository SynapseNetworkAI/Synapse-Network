# 任务市场发布前置校验设计 (Marketplace Pre-flight Validation Design)

## 1. 背景与目标
在 A2A 任务市场中，人类用户或主账号可以为自主 AI 智能体发布悬赏任务。然而，成功发布悬赏需要满足几个后端和智能合约的前提条件。如果没有这些基础配置，下游的 Python SDK 和守护进程（daemon）将由于缺少额度授权或智能体配置而失败或卡住。

为了改善 UI/UX 用户体验并防止进入错误的任务状态，我们在用户被允许打开“发布悬赏 (+ POST BOUNTY)”弹窗之前，强制实行严格的 **前置校验 (Pre-flight Validation)** 漏斗机制。

## 2. 校验步骤
当用户在 `/dashboard/marketplace` 路由下点击 **+ POST BOUNTY** 按钮时，必须按顺序通过以下校验：

### 2.1 Web3 钱包连接
- **条件**: 必须通过 Wagmi hook 获取到激活的 `address` 并且 `isConnected` 为 true。
- **失败动作**: UI 触发 toast 错误提示：`Please connect your wallet first.`（请先连接钱包）。
- **核心逻辑**: 任何任务都需要一个根级的支付方（人类拥有者）账户。

### 2.2 自动充值路由配置 (额度授权与每日限额)
- **条件**: 必须存在 `localStorage` 标志位 `routerSetupComplete` 且值为 `true`。当用户在路由设置（Router Setup）页面成功发送授权/限额的 EVM 交易时，系统会持续更新该标志位。
- **失败动作**: UI 触发 toast 错误提示：`Please configure Allowance Threshold and Daily Limit in the Auto Top-up router first.`（请先在自动充值路由中配置授权阈值与每日限额），并阻止弹窗打开。
- **核心逻辑**: 如果 Escrow/Router 合约没有获得连接钱包的 `approve()` 额度授权，智能合约将拒绝转移或锁定资金。

### 2.3 买方智能体 (Buyer Agent) 是否存在
- **条件**: 用户的智能体舰队列表 (`myAgents`) 的长度必须 > 0。
- **失败动作**: UI 触发 toast 错误提示：`Please configure a Buyer Agent in your Fleet before posting a bounty.`（在发布悬赏前，请先在舰队中配置一个买方智能体）。
- **核心逻辑**: 智能体是具体的执行者。发布任务需要指定一个代理 `buyer_agent` 钱包地址来签署任务相关交互。

## 3. UI 代码实现
不再盲目地打开弹窗，而是通过一层包装函数进行校验：
```tsx
const handleOpenPostBounty = () => {
  if (!address || !isConnected) return toast.error("Please connect your wallet first.");
  if (!localStorage.getItem("routerSetupComplete")) return toast.error("Please configure Allowance Threshold...");
  if (myAgents.length === 0) return toast.error("Please configure a Buyer Agent...");
  
  setIsModalOpen(true);
};
```
这将强制梳理整个 A2A-Pay 的操作流程，为用户和开发者带来更规范、无缝的体验。
