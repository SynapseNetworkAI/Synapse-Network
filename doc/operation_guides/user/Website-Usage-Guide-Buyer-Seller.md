# AgentPay 使用说明（官网定位版）

> 面向对象：买家/调用方、卖家/服务方、运营人员。  
> 目标：用最少步骤完成接入、调用、扣费确认、收益查看与结算提现。

---

## 1. 你可以用 AgentPay 做什么

- 买家：为 Agent 充值并授权，调用第三方卖家 API。
- 卖家：注册 API 服务，被调用后自动获得收入。
- 平台：统一网关鉴权、扣费、记账与结算，保证可审计。

---

## 2. 买家快速上手（5 步）

## Step 1：连接钱包并登录

1. 打开官网首页，点击 `进入控制台`。
2. 连接钱包并完成签名登录。

成功标志：顶部显示钱包地址与网络信息。

## Step 2：充值到智能合约担保（Deposit）

1. 进入充值入口（Router/Top-up）。
2. 输入 USDC 金额并发起 `deposit`。
3. 等待链上确认。

注意：链上确认前，这笔金额不计入 `available_balance`。

## Step 3：签发 Agent 凭据

1. 进入 `Credentials`。
2. 选择 `agent_id` 和 `service_scope`。
3. 设置 `TTL / max_calls / rpm` 并签发。

产出：`X-Agent-Credential`（给你的 Agent 使用）。

## Step 4：调用卖家接口

1. 在 `Buy` 或 `Overview` 的调用区选择服务。
2. 填写请求参数并发起调用。
3. 请求通过平台网关转发到卖家 API。

每笔调用都会返回扣费信息（含余额变化）。

## Step 5：查看消费账单

1. 进入 `Billing`。
2. 按时间与服务筛选查看流水。
3. 重点看：`request_id`, `unit_price`, `platform_fee`, `seller_net`。

---

## 3. 卖家快速上手（5 步）

## Step 1：注册 Agent

1. 进入 `Sell` 或 `Agents`。
2. 创建一个卖家 Agent。

## Step 2：注册 Service

1. 进入 `Services`。
2. 填写 `endpoint`、`unit_price`、`fee_rate`、`service_id`。
3. 上线服务并保持 endpoint 可访问。

## Step 3：接收平台转发调用

- 买家调用时，平台网关先鉴权和扣费，再转发到你的 endpoint。
- 你只需要稳定提供 API 响应。

## Step 4：查看收益

1. 打开 `Overview` 或 `Billing`。
2. 查看 `seller_net` 累计与调用次数。

## Step 5：发起提现结算

1. 打开 `Settlement`。
2. 对待结算余额发起提现。
3. 使用钱包完成链上 `claim`。

---

## 4. 扣费是怎么发生的

统一公式：

- `platform_fee = unit_price * fee_rate`
- `seller_net = unit_price - platform_fee`

调用成功：
- 买家余额减少 `unit_price`
- 卖家收入增加 `seller_net`
- 平台累计 `platform_fee`

调用失败：
- 按策略回滚或部分扣费（以系统配置为准）

---

## 5. 充值担保与资金安全

- 买家资金先进入智能合约 Vault。
- 平台不会凭空记账，需以链上充值事件为准。
- 入账后才可消费，避免“未到账先花费”。

---

## 6. 常见问题

## Q1: 为什么提示会话缺失？

- 原因：钱包签名会话过期或被清理。
- 处理：重新连接钱包并完成签名登录。

## Q2: 为什么有余额但不能调用？

- 可能原因：
  - 充值还在确认中
  - 凭据已过期/撤销
  - 额度或限流触发

## Q3: 如何确认这笔钱扣到哪里？

- 在 `Billing` 查看该笔 `request_id` 的拆分字段：`platform_fee` 与 `seller_net`。

## Q4: 卖家多久能提现？

- 达到结算条件后可在 `Settlement` 发起，实际到账受链上确认时间影响。

---

## 7. 建议操作习惯

- 买家：按服务分配独立凭据，避免单凭据权限过大。
- 卖家：按服务监控成功率和延迟，避免扣费后业务失败率过高。
- 运营：每天对账一次（链上余额 vs 离链账本）。

---

## 8. 快速入口索引

- 官网首页：`/`
- 控制台总览：`/dashboard`
- 凭据管理：`/dashboard/credentials`
- 服务管理：`/dashboard/services`
- Agent 管理：`/dashboard/agents`
- 路由/充值配置：`/dashboard/router`

---

## 9. 一句话总结

买家通过“充值 + 凭据”获得安全调用能力，卖家通过“接入 + 调用计费”持续获得收益，平台通过统一网关把整个过程做到**高频、透明、可结算**。