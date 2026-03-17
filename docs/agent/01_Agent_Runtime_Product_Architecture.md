# Agent Runtime 产品架构

> 目标：定义 Synapse Agent Runtime 的系统边界、主执行循环、核心对象与版本边界。

## 1. 产品边界

Synapse 不是给人类手工逛 API 的市场，而是一条 Agent 自动发现、自动决策、自动调用、自动支付的执行基础设施。

产品边界如下：

| 角色 | 核心职责 | 不该承担的职责 |
| --- | --- | --- |
| Owner | 连接钱包、充值、创建 Agent、设置预算、查看报表 | 不该频繁手工挑服务和逐次批准调用 |
| Agent Runtime | 发现服务、选择服务、执行调用、消耗预算 | 不该接触主钱包私钥 |
| Gateway | 鉴权、风控、报价、路由、记账、审计 | 不该承担链上资产托管 |
| Contract Vault | 资产托管、充值、提现清算 | 不该做高频预算和调用限流 |
| Seller | 提交 Manifest、维护服务健康、接收入账 | 不该要求买家对每个服务单独申请 key |

## 2. Runtime 五层架构

Synapse Runtime 建议拆成五层：

1. **Owner Control Plane**
   负责充值、创建 Agent、发 credential、设预算、看账单。
2. **Discovery Plane**
   负责检索、筛选、排序、返回 Agent 可消费的候选服务。
3. **Execution Plane**
   负责 Quote、Invoke、扣费、路由、重试、结果回传。
4. **Risk Plane**
   负责预算、额度、限流、服务范围、异常熔断、审计追踪。
5. **Settlement Plane**
   负责平台账本、卖家应收、主金库出入金、提现清算。

## 3. 主执行循环

一个健康的 Agent Runtime 主循环：

1. Agent 接收任务目标
2. Agent 调用 Discovery 获取候选服务
3. Agent 选中服务后请求 Quote
4. Gateway 返回价格、预算影响、调用条件
5. Agent 发起 Invoke
6. Gateway 执行鉴权、风控、路由、记账
7. Agent 收到结构化结果或结构化错误
8. Agent 继续下一步编排

三点铁律：

- Discovery 是决策输入，不是展示列表
- Quote 是风险预检查，不是多余中间层
- Invoke 才是正式扣费执行点

## 4. 控制链路与执行链路

补充边界原则：

- 控制链路可以看到 Owner、Credential、预算、审计等控制面对象。
- 执行链路只暴露 Agent 调用服务所必需的信息，不暴露卖家结算资料、平台路由策略、内部账本主键。
- Settlement Plane 只服务平台内部清算和对账，不直接进入 Agent-facing 协议。

### 4.1 控制链路

`Owner -> Dashboard -> Gateway Control API -> Credential/Budget Store`

用途：

- 创建 Agent
- 生成 / 吊销 Credential
- 设置总预算 / 日预算 / 速率限制
- 查看消费历史和风险告警

### 4.2 执行链路

`Agent Runtime -> Discovery API -> Quote API -> Invoke API -> Seller Endpoint`

用途：

- 查服务
- 询价
- 发起调用
- 获取结果
- 完成扣费和审计

## 5. 核心领域对象

V1 至少需要这些对象：

- `OwnerAccount`
- `AgentProfile`
- `AgentCredential`
- `BudgetPolicy`
- `ServiceManifest`
- `ServiceQuote`
- `InvocationRequest`
- `InvocationReceipt`
- `LedgerEntry`
- `AuditEvent`

建议继续拆成两种视图：

- **Agent-facing objects**：`ServiceManifest`、`ServiceQuote`、`InvocationRequest`、`InvocationReceipt`
- **Platform-internal objects**：`OwnerAccount`、`LedgerEntry`、`AuditEvent`、Settlement 相关对象

要求：

- 每个对象职责单一
- 不把服务信息、凭据、预算、调用结果糊成一个响应
- 账本对象与调用对象分离，避免后续对账混乱
- 公开服务契约与内部结算对象分离，避免 Agent 误依赖平台内部字段

## 6. Runtime 状态机

标准调用状态机建议为：

1. `DISCOVERED`
2. `QUOTED`
3. `AUTHORIZED`
4. `INVOKING`
5. `SUCCEEDED`
6. `FAILED_RETRYABLE`
7. `FAILED_FINAL`
8. `SETTLED`

状态机要求：

- 每次状态流转必须可审计
- `FAILED_RETRYABLE` 与 `FAILED_FINAL` 必须区分
- `SETTLED` 是账本完成状态，不等于业务成功

## 7. 目标转化漏斗

Synapse 的核心转化漏斗不是“钱包连接成功”，而是：

1. Owner deposited USDC
2. Owner created Agent credential
3. Agent discovered a service
4. Agent got quote approval in policy
5. Agent invoked service successfully
6. First paid invocation settled and audited

我们真正要优化的是第 3 到第 6 步。

## 8. V1 与 V2 边界

### 8.1 V1 必须做

- 明确的 Discovery / Quote / Invoke 三段式
- 单 Agent 单 Credential
- 固定价格或简单阶梯报价
- 基础标签检索 + 条件筛选
- 基础预算和速率控制
- 结构化错误码

### 8.2 V2 再做

- 语义检索和向量排序
- 动态竞价与多卖家竞价
- Workflow 级组合报价
- 多 Agent 共享预算池
- SLA 驱动自动切换供应商

结论：V1 先打通“第一次自主付费调用”闭环，别一上来把平台做成低效大而全。