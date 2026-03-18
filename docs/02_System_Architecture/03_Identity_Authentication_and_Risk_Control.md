# Identity, Authentication, and Risk Control

## 1. 目标

本文件定义 Synapse 如何把身份、鉴权和风控串成统一控制链，而不是三套彼此割裂的子系统。

## 2. 身份分层

### 2.1 Owner Identity

Owner 是控制面根身份。

Owner 负责：

1. session 建立
2. deposit
3. create agent
4. set budget
5. provider role operations

### 2.2 Agent Credential

Agent credential 是 Runtime 支付身份。

它的职责是：

1. 绑定 agent
2. 限定预算
3. 限定调用范围
4. 承担自动调用的最小权限执行面

### 2.3 Provider Role

Provider 不是另一套根身份，而是 Owner 的供给侧业务角色。

### 2.4 Platform Admin

Admin 身份必须和普通 Owner 完全隔离。

## 3. 鉴权原则

### 3.1 默认拒绝

除公开 discover 或网络摘要接口外，所有写路径都要求有效身份。

### 3.2 Owner Binding

任何 owner-scoped 行为，都必须由服务端 token subject 推导 owner，而不是信任客户端字段。

### 3.3 Least Privilege

1. Owner 控制面只能操作自己资源
2. Agent credential 只能在被授权 scope 内运行
3. Provider 只能操作自己归属的 service
4. Admin 权限必须独立

## 4. 风控分层

### 4.1 Funding Risk

关注：

1. deposit replay
2. tx hash duplication
3. suspicious funding source
4. reconciliation mismatches

### 4.2 Runtime Risk

关注：

1. budget exhaustion
2. daily cap hit
3. rate limiting
4. scope denied
5. abnormal failure spikes

### 4.3 Payout Risk

关注：

1. provider withdrawal amount spikes
2. account age and behavior anomaly
3. liquidity pressure
4. payout address anomaly

## 5. 风险等级

当前最稳定的分级模型是：

1. `green`
2. `yellow`
3. `red`

语义：

1. `green` 自动放行
2. `yellow` 进入人工审核或额外检查
3. `red` 直接拒绝并审计

## 6. 风控执行点

### 6.1 Deposit

在登记和确认阶段检查：

1. tx uniqueness
2. amount validity
3. chain event match

### 6.2 Quote / Invoke

在执行前检查：

1. credential validity
2. budget validity
3. rate limits
4. service scope
5. balance sufficiency

### 6.3 Refund / Withdrawal

在出金前检查：

1. source bucket correctness
2. amount sufficiency
3. abnormal patterns
4. manual review threshold
5. signature / nonce / deadline requirements

## 7. Admin Risk Control Plane

Risk control 不应只停留在 Gateway 内部逻辑，还必须在 Admin plane 有可观察性。

至少要可见：

1. yellow queue
2. red alerts
3. liquidity status
4. deposit reconciliation backlog
5. abnormal invocation clusters

## 8. 文档结论

Synapse 的身份和风控不是“登录之后再补几条校验规则”，而是：

**Owner root identity + Agent runtime credential + Provider role + risk gates**

共同组成的统一控制链。