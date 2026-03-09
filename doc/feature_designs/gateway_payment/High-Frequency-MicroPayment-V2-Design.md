# 高频小额调用结算架构 V2（Simple 版）

> 目标：在保留现有安全边界的前提下，让 Agent 高频、小金额调用具备更低延迟、更低链上成本、更高吞吐。

## 1. 背景与问题

当前 V1 模式是“每次调用前先链上支付（`payForService`）+ 再调用”。

优点：
- 资金与请求强绑定，审计清晰。

限制：
- 高频小额场景下，链上交互太重；
- 延迟高（确认等待）；
- 每次都要带 `X-Tx-Hash`，调用链复杂。

## 2. 设计目标

- 高频：支持秒级多次调用。
- 小额：每次调用金额很小也可经济可行。
- 安全：保持 owner / agent / service 三维治理能力。
- 可回滚：尽量兼容 V1，支持灰度切换。

## 3. 核心思路（Simple V2）

采用 **预充值 + 离链扣费账本 + 周期上链结算**：

1) 买家先向平台结算池进行预充值（链上一次大额）。
2) 调用时不再逐笔上链，只在平台账本扣减余额并记审计流水。
3) 到达周期或阈值后，平台批量把卖家应收结算上链。
4) 失败调用不扣费或按策略扣费（可配置）。

## 4. 组件与职责

### 4.1 Balance Ledger（平台离链账本）

新增概念：
- `buyerBalance`：买家可用余额。
- `sellerReceivable`：卖家待结算应收。
- `platformFeeAccrued`：平台累计手续费。

每笔调用产生日志：
- `requestId`
- `buyerAddress`
- `sellerAddress`
- `serviceId`
- `unitPrice`
- `feeAmount`
- `netAmount`
- `status`（accepted/succeeded/failed/refunded）
- `timestamp`

### 4.2 Credential（调用凭据）

仍保留当前机制：
- Header：`X-Agent-Credential`
- 能力：身份识别、限流、额度、到期控制。

### 4.3 Settler（批量结算任务）

后台任务按条件触发：
- 时间窗口（如每 5 分钟）
- 金额阈值（如累计到 20 USDC）

结算动作：
- 将 `sellerReceivable` 批量转账至卖家；
- 抽取 `platformFeeAccrued` 至手续费地址；
- 生成结算批次审计（batchId / txHash / range）。

## 5. 请求流程

### 5.1 预充值流程（低频上链）

1. 买家调用 `deposit`（链上）。
2. 平台监听或确认交易后增加 `buyerBalance`。

### 5.2 高频调用流程（高频离链）

1. 买家请求 Seller API，携带：
   - `Authorization`（平台会话）
   - `X-User-Address`
   - `X-Agent-Credential`
2. 网关校验：
   - 凭据有效（未撤销、未过期、未超配额）
   - 三维限流通过（owner/agent/service）
   - `buyerBalance >= unitPrice`
3. 通过后：
   - 预扣或实扣（按策略）
   - 请求放行到业务执行
4. 调用完成：
   - 成功：固化扣费，增加卖家应收与平台费
   - 失败：按策略回滚或部分扣费

### 5.3 批量结算流程（中频上链）

1. Settler 扫描 `sellerReceivable`。
2. 发起批量结算交易。
3. 结算成功后将应收清零并记录 `txHash`。

## 6. API 建议（最小新增）

- `POST /api/v2/balance/deposit/intent`（可选）
- `GET /api/v2/balance`
- `GET /api/v2/usage/logs`
- `POST /api/v2/settlement/run`（仅管理端/任务触发）

> 兼容策略：
> - 保留 V1 `/api/v1/generate`（逐笔链上支付）
> - 新增 V2 `/api/v2/generate`（离链扣费 + 批量结算）

## 7. 凭据问题（直接回答）

### 7.1 签发凭据是否仍需要人类？

- 当前实现：通常由人类 owner 在控制面签发。
- V2 建议：可改为“策略化自动签发/轮转”，例如：
  - owner 预设策略（TTL、maxCalls、rpm、service scope）
  - 平台使用受限管理密钥自动签发
  - 人类只做策略审批，不逐次人工操作

### 7.2 凭据的作用是什么？

凭据不是支付凭证，主要负责：
- 调用身份（哪个 agent 在调用）
- 风险控制（限流、配额、作用域）
- 安全控制（可撤销、可过期）
- 审计关联（把调用与 agent/service 绑定）

### 7.3 凭据到期后还能调用吗？

- 不能。到期后应直接返回 401（`AGENT_CREDENTIAL_EXPIRED`）。
- 若业务需要无缝：
  - 提前轮转（T-5 分钟签发新凭据）
  - 双凭据短暂并行（旧凭据 grace period）

## 8. 费率与经济模型（简单版）

每次调用：
- `unitPrice = servicePrice`
- `platformFee = unitPrice * feeRate`
- `sellerNet = unitPrice - platformFee`

结算时：
- 卖家收到 `sum(sellerNet)`
- 平台收到 `sum(platformFee)`

## 9. 风险与防护

- 重放风险：请求必须带 `requestId` 并在短窗口去重。
- 余额竞争：扣费时使用原子更新（事务/锁）。
- 结算失败：批次可重试且幂等（batchId）。
- 长尾失败：失败调用回滚策略要固定并审计。

## 10. 迁移路径（建议）

1. 第一步：保留 V1，新增 V2 账本与余额 API。
2. 第二步：部分低风险服务灰度到 `/api/v2/generate`。
3. 第三步：启用自动凭据轮转。
4. 第四步：开启批量结算任务并逐步扩大覆盖。

---

## 一句话结论

对 Agent 高频小额调用，V2 应采用“低频上链充值 + 高频离链扣费 + 周期上链结算”；凭据继续存在且非常关键，它控制“谁可以调用、多久能调用、调用多少次”，过期后默认不能继续调用。