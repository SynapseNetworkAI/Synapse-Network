# TypeScript SDK — Consumer E2E 自动化测试方案

> **目标**：从零创建一个空钱包，全程通过 TypeScript SDK 完成 Consumer 完整链路：  
> 链下钱包创建 → 链上充值 → 网关认证 → Credential 颁发 → 服务发现 → 报价 → 调用 → 余额验证

---

## 1. 测试范围

| # | 阶段 | 验证点 |
|---|------|--------|
| 0 | 环境检查 | Hardhat 节点可达、Gateway 健康、前端 3000/3002 可访问 |
| 1 | 创建钱包 | 使用 `ethers.Wallet.createRandom()` 生成全新 EOA 地址 |
| 2 | 链上 ETH 注入 | Deployer 向新钱包转 0.5 ETH，验证 `getBalance()` > 0 |
| 3 | 链上 USDC Mint | Deployer 调用 `MockUSDC.mint()` 向新钱包注 10 USDC，验证 `balanceOf()` = 10e18 |
| 4 | 链上充值 | 新钱包 `approve(SynapseCore, amount)` + `SynapseCore.deposit(amount)` |
| 5 | 网关认证 | `SynapseAuth.fromWallet()` → challenge → EIP-191 签名 → JWT，缓存验证 |
| 6 | 充值登记 | `registerDepositIntent(txHash, amount)` + `confirmDeposit(intentId, eventKey)` |
| 7 | 余额确认 | `getBalance().consumerAvailableBalance >= DEPOSIT_USDC` |
| 8 | Credential 颁发 | `issueCredential({ name, maxCalls, creditLimit })` → agentToken 不为空 |
| 9 | 服务发现 | `SynapseClient.discover()` 返回列表；能找到本次注册的测试服务 |
| 10 | 报价 | `client.quote(serviceId)` → quoteId 不为空 |
| 11 | 服务调用 | `client.invoke(serviceId, payload)` → status SUCCEEDED/SETTLED |
| 12 | 费用扣除 | `invocationResult.chargedUsdc > 0` |
| 13 | 调用凭证 | `client.getInvocation(invocationId)` → 状态可查 |
| 14 | 结算后余额 | `getBalance().consumerAvailableBalance < balance_before_invoke` |

---

## 2. 服务依赖

```
Hardhat local node   http://127.0.0.1:8545  (npx hardhat node)
Gateway              http://127.0.0.1:8000  (sh scripts/local/restart_gateway.sh)
Frontend (可选)      http://localhost:3000  (yarn dev in apps/frontend)
Mock Provider       http://127.0.0.1:9299  (测试内部 Node.js HttpServer 自启动)
```

合约地址来自 `apps/frontend/src/contract-config.json`（由 Hardhat 部署脚本写入）：
- `MockUSDC` — ERC-20，有 `mint(address, uint256)` 方法，仅 Deployer 可调用
- `SynapseCore` — `deposit(uint256)` 接收 USDC，调用前需 approve

---

## 3. 关键角色

| 角色 | 私钥来源 | 作用 |
|------|----------|------|
| Deployer | Hardhat #0 | 拥有 MockUSDC mint 权限；向新钱包转 ETH |
| Fresh Consumer | `Wallet.createRandom()` | 本次测试主角 |
| Provider | Hardhat #2 | 注册测试服务（供发现和调用使用） |

---

## 4. 测试流程图

```
┌─────────────────────────────────────────────────────────────────┐
│  beforeAll (一次性 setup)                                        │
│                                                                 │
│  [deployer] ──ETH 0.5──►  [fresh wallet]                       │
│  [deployer] ──mint 10 USDC──► [fresh wallet]                   │
│  [fresh wallet] ──approve──► SynapseCore                       │
│  [fresh wallet] ──deposit──► SynapseCore  ──txHash──►          │
│                                                                 │
│  [fresh wallet] ──auth──► Gateway JWT                          │
│  registerDepositIntent(txHash) ──► confirmDeposit(intentId)    │
│                                                                 │
│  [provider] ──auth──► registerService(mockUrl) ──► serviceId   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tests                                                          │
│                                                                 │
│  1. Authentication (JWT + cache)                                │
│  2. Balance (≥ DEPOSIT_USDC after confirm)                      │
│  3. issueCredential → agentToken                                │
│  4. client.discover() → list non-empty; includes test service   │
│  5. client.quote(serviceId) → quoteId                          │
│  6. client.invoke() → SUCCEEDED; chargedUsdc > 0; result ok    │
│  7. client.getInvocation(id) → receipt by ID                   │
│  8. balance after < balance before invoke                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 验收标准

- 所有 16 个 Jest test case 通过（`PASS`）
- `chargedUsdc > 0`（实际结算发生）
- `consumerAvailableBalance` 全程正确递减
- 整体运行时间 < 120 秒

---

## 6. 测试文件位置

| 文件 | 说明 |
|------|------|
| `sdk/typescript/tests/e2e/new-consumer.test.ts` | 主测试文件 |
| `docs/test/sdk/consumer-e2e-plan.md` | 本文档 |
| `docs/bugfix/sdk/bugs.md` | Bug 记录 |

---

## 7. 运行命令

```bash
cd sdk/typescript
npm run test:new-consumer
# 等价于: npx jest tests/e2e/new-consumer.test.ts --verbose
```

---

## 8. 环境变量（可选覆盖）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SYNAPSE_GATEWAY` | `http://127.0.0.1:8000` | Gateway URL |
| `RPC_URL` | `http://127.0.0.1:8545` | Hardhat JSON-RPC |
| `DEPOSIT_USDC` | `10` | 充值金额（USDC） |
