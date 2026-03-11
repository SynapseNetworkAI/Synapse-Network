# 结算设计详细文档（Deposit + 网关记账 + Signature Claim）

> 基于“结算核心”提炼的工程化方案。  
> 目标：在高频小额场景下，做到调用低延迟、结算安全、平台低 Gas 成本。

---

## 1. 设计目标

- 高频调用离链化：调用过程不逐笔上链。
- 资金安全上链化：充值与提现在合约层完成。
- 结算成本可控：平台不承担卖家提现 Gas。
- 全链路可审计：每次调用、每次结算、每个签名可追溯。

---

## 2. 结算总览

采用三段式模型：

1) **On-chain 充值（Deposit）**：买家把 USDC 充值到金库合约。  
2) **Off-chain 扣费记账（Gateway Ledger）**：平台网关按调用扣费，累计卖家应收。  
3) **On-chain 提现（Claim）**：卖家发起提现，平台签发 EIP-712 提现授权，卖家自付 Gas 到链上领取。

```mermaid
flowchart LR
  B[Buyer] -->|deposit USDC| V[Vault Contract]
  B -->|invoke| G[Platform Gateway]
  G -->|forward| S[Seller Service]
  G --> L[Ledger DB]

  R[Seller] -->|request withdraw| W[Withdraw API]
  W -->|issue EIP-712 claim ticket| R
  R -->|claim(ticket, sig)| V
  V -->|transfer USDC| R
```

---

## 3. 资金与账户模型

### 3.1 买家余额
- `available_balance`：可用于调用的余额。
- `locked_balance`：预留/风控冻结金额（可选）。

### 3.2 卖家应收
- `seller_receivable`：已完成调用累计净收入（可提现）。

### 3.3 平台收益
- `platform_fee_accrued`：平台累计手续费。

### 3.4 计费公式
设：
- 单次服务价格 `P`
- 费率 `r`

则：
- `fee = P * r`
- `seller_net = P - fee`

调用成功后：
- 买家余额 `-P`
- 卖家应收 `+seller_net`
- 平台收益 `+fee`

---

## 4. 提现结算机制（Signature Claim）

## 4.1 为什么用 Signature Claim
- 平台后端只签名，不代付链上 Gas。
- 卖家自己发链上交易领取资金。
- 避免平台 Relayer 成本随卖家数增长失控。

## 4.2 提现流程

### Step A：卖家申请提现（Off-chain）
1. 卖家在前端提交 `withdraw_request(amount)`。
2. 后端校验：
   - 应收余额是否足够
   - 最低提现门槛（如 `>= 10 USDC`）
   - 是否命中风控（冻结、黑名单、争议中）
3. 后端创建 `withdraw_intent`，并将对应应收额度置为 `pending_claim`（防重复领取）。

### Step B：平台签发“提现票据”（Off-chain）
后端生成 EIP-712 签名，返回给前端：
- `claimId`
- `seller`
- `token`
- `amount`
- `nonce`
- `deadline`
- `chainId`
- `vault`
- `signature`

### Step C：卖家链上 Claim（On-chain）
1. 前端调用 `Vault.claim(...)`。
2. 合约验证：
   - 签名 signer 是否为平台授权地址
   - `nonce` 未使用
   - `deadline` 未过期
   - 参数未篡改
3. 验签通过后转账 USDC 给卖家，并标记 nonce 已消费。

### Step D：回写结果（Off-chain）
- 平台监听/查询 `claim` 交易回执，更新 `withdraw_intent` 为 `confirmed/failed`。

---

## 5. 合约接口建议

```solidity
function deposit(address token, uint256 amount) external;
function claim(
  bytes32 claimId,
  address seller,
  address token,
  uint256 amount,
  uint256 nonce,
  uint256 deadline,
  bytes calldata signature
) external;
```

### 5.1 关键存储
- `mapping(uint256 => bool) usedNonce`
- `mapping(bytes32 => bool) usedClaimId`
- `address claimSigner`

### 5.2 关键事件
- `Deposited(buyer, token, amount)`
- `Claimed(claimId, seller, token, amount, nonce)`

---

## 6. EIP-712 签名结构

Domain：
- `name = "Synapse NetworkVault"`
- `version = "1"`
- `chainId`
- `verifyingContract = vaultAddress`

Typed Data：
- `claimId: bytes32`
- `seller: address`
- `token: address`
- `amount: uint256`
- `nonce: uint256`
- `deadline: uint256`

安全要求：
- `claimId` 全局唯一
- `nonce` 单调或随机唯一
- `deadline` 建议 5~30 分钟

---

## 7. 网关与结算衔接

网关每次调用落账时，必须做到：

1. 幂等：`requestId` 唯一，重复请求不重复扣费。  
2. 原子：余额扣减与 usage 记录同事务。  
3. 可追溯：usage 记录包含 `buyer/seller/service/fee/net`。  
4. 可结算：卖家应收可按时间窗口或阈值聚合。

---

## 8. 状态机设计

### 8.1 Usage 状态
- `accepted -> succeeded`
- `accepted -> failed -> refunded`

### 8.2 Withdraw 状态
- `created -> signed -> submitted -> confirmed`
- `created/signed/submitted -> failed`
- `created/signed -> expired`

---

## 9. 风控与异常处理

### 9.1 最低提现门槛
- 防止碎片化提现造成链上拥堵与运营噪音。

### 9.2 T+1 可选账期
- `T+0`：实时可提，体验最好。
- `T+1`：提升风控窗口，降低欺诈风险。

### 9.3 异常场景
- 签名过期：返回需重新签发。
- nonce 冲突：拒绝 claim。
- 链上失败：intent 标记 failed，可重新签发。
- DB 与链上不一致：通过事件回放对账修复。

---

## 10. 对账与审计

每日任务：
1. 充值对账：链上 `Deposited` vs off-chain 入账。
2. 提现对账：链上 `Claimed` vs withdraw intents。
3. 余额守恒检查：

$$
\text{TotalDeposit} - \text{TotalClaimed} = \text{VaultResidual}
$$

$$
\text{BuyerBalanceSum} + \text{SellerReceivableSum} + \text{PlatformFeeAccrued} \approx \text{VaultResidual}
$$

---

## 11. 最小 API 设计

### 控制面
- `POST /api/v2/withdraw/request`
- `GET /api/v2/withdraw/{id}`

### 资金面
- `POST /api/v2/deposit/confirm`
- `GET /api/v2/balance`

### 数据面
- `POST /api/v2/generate`

---

## 12. 实施建议

### Phase 1（MVP）
- 落地 deposit confirm、网关扣费、withdraw request + EIP-712 sign。

### Phase 2
- 加入 T+1 账期、自动对账任务、风控冻结。

### Phase 3
- 多链 claim signer、策略化费率与风险分层。

---

## 13. 结论

“充值上链、调用离链、提现签名上链”是该场景下成本与体验平衡最优解：
- 买家获得高频低延迟调用
- 卖家可自主提现并自付 Gas
- 平台获得可控结算成本与完整审计闭环
