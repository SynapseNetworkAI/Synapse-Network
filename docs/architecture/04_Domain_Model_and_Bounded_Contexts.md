# Domain Model and Bounded Contexts

## 1. 目标

本文件定义 Synapse 该如何切领域边界，避免继续把所有对象塞进一个“万能业务模型”。

## 2. 为什么必须切 bounded contexts

如果不切边界，系统会立刻出现三类问题：

1. Owner / Provider / Agent 的语义互相污染
2. 调用对象和账本对象混在一起，难以对账
3. 控制面、执行面、治理面互相绕过边界

## 3. 建议的五个主领域

### 3.1 Identity and Tenant Context

核心对象：

1. `OwnerAccount`
2. `ProviderProfile`
3. `ProviderPayoutAccount`
4. `AdminIdentity`

职责：

1. 定义谁拥有资源
2. 定义谁可以运营服务
3. 定义谁可以做后台治理

### 3.2 Agent Runtime Context

核心对象：

1. `AgentProfile`
2. `AgentCredential`
3. `BudgetPolicy`
4. `BudgetEvent`

职责：

1. 定义运行时身份
2. 定义预算边界
3. 定义 reserve / capture / release

### 3.3 Service Network Context

核心对象：

1. `ServiceManifest`
2. `ServiceEndpoint`
3. `ServiceHealthSnapshot`
4. `ServiceSearchIndex`
5. `ServiceQuote`

职责：

1. 定义服务公开契约
2. 定义 endpoint 运行约束
3. 定义 discover 和 quote 的商业入口

### 3.4 Settlement and Ledger Context

核心对象：

1. `Invocation`
2. `LedgerAccount`
3. `AccountBalance`
4. `LedgerEntry`
5. `VaultDeposit`
6. `VaultWithdrawal`

职责：

1. 定义所有资金和结算真相
2. 定义入金、扣费、收益、提现、退款

### 3.5 Governance and Reliability Context

核心对象：

1. `AuditEvent`
2. `IdempotencyKey`
3. `RuntimeState`
4. `ApprovalRecord`

职责：

1. 定义可审计性
2. 定义幂等和回放控制
3. 定义治理与后台审批能力

## 4. 上下文之间的边界关系

### 4.1 Identity -> Runtime

Owner 拥有 Agent，但 Owner 本身不等于 Agent。

### 4.2 Runtime -> Service Network

Agent credential 约束谁可以消费哪些 service。

### 4.3 Service Network -> Settlement

quote 和 invocation 进入结算层后，才变成真实资金动作。

### 4.4 Settlement -> Governance

所有关键资金动作都必须产出 audit event，并在高风险场景进入治理流。

## 5. 反模式

以下做法全部属于架构反模式：

1. 用一个 `BalanceRecord` 同时表达消费余额、收益余额、冻结余额和平台费
2. 用一个 `UserRole` 枚举同时定义 Owner、Provider、Admin、Agent
3. 用一张 service 表同时塞 manifest、endpoint、health、pricing、payout 和路由策略
4. 让前端页面字段直接驱动数据库对象语义

## 6. 文档结论

Synapse 的领域模型必须围绕边界，而不是围绕页面菜单组织。

只有把 Identity、Runtime、Service Network、Settlement、Governance 五个 bounded contexts 切开，平台才能继续高速迭代而不把账本和协议写烂。