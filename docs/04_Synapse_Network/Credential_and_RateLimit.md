# Provider Secret 与限流实现补充说明

> 状态更新（2026-03-17）：本文档不再定义 Runtime 的 canonical credential 模型。
>
> 当前 Runtime 主模型以 `docs/agent/04_Credential_Budget_Risk_Model.md` 和 `docs/agent/06_Build_For_Agent_Database_Rebuild.md` 为准；本文只保留 Provider 控制面的历史兼容说明。

## 迁移说明

本文过去容易被误读成 Runtime credential 设计文档，现已被以下 canonical 文档替代：

1. Agent Credential / Budget Policy 主模型：`docs/agent/04_Credential_Budget_Risk_Model.md`
2. Runtime 数据模型与凭据持久化边界：`docs/agent/06_Build_For_Agent_Database_Rebuild.md`
3. 对外鉴权与错误码契约：`docs/api.md`

本文剩余保留价值只有一项：说明 Provider 控制面如果仍保留 `provider secret / service key`，它应该如何与 Agent Runtime 主凭据彻底隔离。

## 1. 为什么还保留本文档

因为平台当前仍可能存在 Provider 侧的 `provider secret / service key` 控制面实现，而这套东西和 Agent Runtime 的 `Agent Credential` 不是同一个对象。

简单说：

1. `Agent Credential`：给 Agent Runtime 花钱、拉 quote、发 invocation 用。
2. `Provider Secret / Service Key`：给 Provider 控制面或平台到 Provider 的服务访问控制用。

两者不能混成一个协议面。

## 2. 当前推荐边界

### 2.1 Canonical Runtime

以下主题不要再从本文档定义：

1. Agent Runtime 的 credential 字段。
2. Budget policy 的主模型。
3. Discovery / Quote / Invoke 的鉴权语义。

这些都以 `docs/agent/04_Credential_Budget_Risk_Model.md` 和 `docs/api.md` 为准。

### 2.2 Provider Secret 的适用面

本文只覆盖 Provider 控制面相关能力：

1. Provider 签发和撤销 service key。
2. Provider 控制自己挂载服务的访问源。
3. Provider 侧局部限流与调用审计。

## 3. 当前实现补充

### 3.1 Service Key 最小模型

- `id`
- `ownerAddress`
- `name`
- `tokenHash`
- `rpm`
- `expiration`
- `status`
- `createdAt / updatedAt / revokedAt`

### 3.2 Provider 侧限流建议

如果保留 provider secret 体系，限流至少分两层：

1. `service key` 级 RPM 限流
2. `provider owner` 级全局 RPM 限流

命中限流时，Provider 控制面可以继续使用 `RATE_LIMITED` 语义，但不要把它和 Agent Runtime 已发布错误码集合混成同一层 contract。

### 3.3 与 Runtime 的隔离要求

1. Provider Secret 不能直接代替 Agent Credential 去消费 Runtime。
2. Provider Secret 的审计主体是 Provider，不是 Owner-Agent 支付链路。
3. 生产态建议与 Agent Credential 分表、分索引、分审计 retention。

## 4. 后续迁移方向

1. 运行时支付身份继续收敛到 `Agent Profile + Agent Credential + Budget Policy`。
2. Provider 控制面如需保留 key 体系，应把它视为后台配置与服务访问控制，而不是公开 Runtime 协议。
3. 所有对 Agent 暴露的鉴权、错误码、限流语义，都应回写到 `docs/api.md`，不要再从本文档扩散。

