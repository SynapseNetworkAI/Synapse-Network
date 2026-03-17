# Credential / Budget 风控模型

> 目标：定义 Agent Runtime 的支付身份、预算边界、风控顺序和预算账本模型。

## 1. 模型目标

Credential 不是通行证，而是带预算和风控边界的运行时支付身份。

它要同时解决三件事：

1. 让 Agent 能自主消费
2. 让 Owner 不会被失控 Agent 烧穿
3. 让 Gateway 能在毫秒级做出放行或拦截

## 2. 对象结构

补充边界原则：

- Credential / Budget 文档同时覆盖 Agent-facing 使用面和平台内部控制面，但两者字段不应混用。
- Agent 持有的是运行时凭据 secret 和最小必要上下文；Owner 与 Gateway 才能看到完整预算策略、账本和控制字段。

### 2.1 AgentProfile

- `agent_id`
- `owner_id`
- `name`
- `purpose`
- `status`

### 2.2 AgentCredential

- `credential_id`
- `agent_id`
- `owner_wallet`
- `secret_last4`
- `status`
- `expires_at`
- `allowed_scopes`

建议拆成两层视图：

- **Agent-facing credential view**：`credential_id`、secret、本凭据可用范围、过期时间
- **Platform-internal credential record**：`owner_wallet`、吊销状态、创建人、风控标签、审计元数据

说明：

- `owner_wallet` 是平台控制面和审计面需要的绑定信息，不是 Seller 或其他外部服务需要知道的字段。
- 对外发给 Agent SDK 的 credential 载荷，应保持最小披露。

### 2.3 BudgetPolicy

- `budget_policy_id`
- `credential_id`
- `lifetime_cap_usdc`
- `daily_cap_usdc`
- `per_invocation_cap_usdc`
- `rpm_limit`
- `qps_limit`
- `allowed_service_tags`
- `allowed_service_ids`
- `blocked_service_ids`

## 3. 风控判定顺序

Gateway 每次调用必须按这个顺序检查：

1. Credential 是否存在
2. Credential 是否有效且未吊销
3. Quote 是否存在且未过期
4. Service 是否在允许范围
5. 单次调用是否超过 `per_invocation_cap_usdc`
6. 当日累计是否超过 `daily_cap_usdc`
7. 生命周期累计是否超过 `lifetime_cap_usdc`
8. RPM / QPS 是否超限
9. Owner 主账户可用余额是否足够

这套顺序不能乱。先挡最便宜的检查，再做最贵的执行。

## 4. 预算账本模型

预算不能只靠“剩余金额字段”硬减，必须有账本支撑。

至少需要三类记录：

1. `budget_reservation`
   在 Quote 或 Invoke 前暂时占用额度
2. `budget_capture`
   调用成功后正式记账
3. `budget_release`
   调用失败或报价过期后释放占用

这样做的原因是：

- 防止并发下超额消费
- 支持 Quote 锁价窗口
- 支持异步调用后的最终结算

## 5. 风险事件与告警

平台至少要记录这些风险事件：

- `credential_created`
- `credential_revoked`
- `budget_warning_80`
- `budget_exhausted`
- `daily_limit_hit`
- `rate_limit_hit`
- `scope_denied`
- `seller_timeout_spike`
- `invoke_failure_spike`

这些事件要同时服务三类消费者：

1. Dashboard 告警
2. 风控规则引擎
3. 审计与运维排障

补充要求：

- 风险事件可以包含内部对象关联键和账本映射，但这些信息不进入 Agent-facing API 响应。
- Agent-facing 错误只返回可执行动作，不返回内部风控命中规则细节。

## 6. 错误动作映射

| 错误码 | Agent 动作 | Owner 动作 |
| --- | --- | --- |
| `BUDGET_EXHAUSTED` | 停止该 credential 调用，换低价服务或结束任务 | 充值或提高预算 |
| `DAILY_LIMIT_EXCEEDED` | 延迟到下一窗口或切换备用 credential | 调整日额度 |
| `RATE_LIMITED` | 退避重试 | 提升速率配置 |
| `SCOPE_DENIED` | 改选允许范围内服务 | 扩充 scope |
| `QUOTE_EXPIRED` | 重新拉 quote | 无需干预 |

## 7. V1 最低闭环

V1 先做到下面 7 条就够上线：

1. 单 Agent 单 Credential
2. 生命周期总预算
3. 日预算
4. 单次调用上限
5. RPM / QPS 限制
6. Service allowlist / blocklist
7. 审计日志 + 预算事件日志

结论：先把硬边界做实，再谈复杂策略引擎。