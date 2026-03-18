# Gateway 计费与扣费实现补充说明

> 状态更新（2026-03-17）：本文件不再定义 canonical Agent Runtime 协议。
>
> 当前主协议以 `docs/agent/02_Discovery_Quote_Invoke_API_Design.md` 和 `docs/api.md` 为准；本文只解释 Gateway 在“HTTP 交付结果如何映射到结算动作”上的实现补充。

## 迁移说明

本文过去承担过部分“调用协议 + 扣费协议”解释职责，现已拆分并被以下 canonical 文档替代：

1. Agent Runtime 调用主协议：`docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
2. 对外 API 返回、错误码与字段语义：`docs/api.md`
3. Budget / Reserve / Capture / Release 主模型：`docs/agent/04_Credential_Budget_Risk_Model.md`
4. 资金结算与扣费链路：`docs/03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md`

本文剩余价值只在于说明 Gateway 内部如何把 canonical 协议落到 HTTP 转发、交付判断和结算动作映射上。

## 1. 本文档的边界

本文只回答三个实现问题：

1. Gateway 什么时候把一次调用视为可结算交付。
2. Gateway 如何处理预冻结、扣款确认、释放占用。
3. 哪些想法仍属于 future-state，不应被误读成当前 contract。

## 2. 当前实现补充

### 2.1 HTTP 语义优先

Synapse 不要求 Provider 把所有业务结果包成 `{ "code": 0 }` 风格的特供 JSON。

当前结算判断仍以 HTTP 原生语义为主：

1. `2xx`：视为成功交付，可进入 capture / commit。
2. `4xx / 5xx`：视为未成功交付，执行 rollback / release。
3. 网络错误、超时、连接失败：视为未成功交付，执行 rollback / release。

这样做的原因很简单：

1. 不增加 Provider 接入摩擦。
2. 不破坏 HTTP 原生错误传达。
3. 兼容流式输出和非统一响应体。

### 2.2 计费动作是 Reserve -> Capture / Release

在 build-for-agent Runtime 下，预算和资金动作已经从旧消费侧 API Key 叙事切到 Quote / Invocation 语义，但核心结算动作仍可理解为三步：

1. `reserve`：在 Quote 或执行前预占预算与余额空间。
2. `capture`：当上游完成有效交付时，正式扣减并写入账本与审计。
3. `release`：当调用失败、超时、过期或未完成交付时，释放占用。

它对应 `docs/agent/04_Credential_Budget_Risk_Model.md` 里的 `budget_reservation` / `budget_capture` / `budget_release` 三类账本动作。

### 2.3 当前推荐的执行结果映射

| 场景 | Gateway 观察到的现象 | 结算动作 |
| --- | --- | --- |
| Upstream success | Provider 返回 `2xx` 或可确认的成功流式完成 | `capture` |
| Upstream rejection | Provider 返回 `4xx/5xx` | `release` |
| Upstream unavailable | 连接失败、DNS 失败、网关超时 | `release` |
| Client aborted before completion | 平台确认未形成成功交付 | `release` |

说明：

- 对 Agent-facing 响应，仍应返回 `docs/api.md` 已发布错误码，而不是暴露内部结算细节。
- 是否“成功交付”要以平台确认的执行结果为准，而不是仅看请求是否发出。

## 3. 与 canonical 文档的映射

1. Agent-facing 协议：看 `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
2. 当前 API 合约：看 `docs/api.md`
3. Credential / Budget 风控账本：看 `docs/agent/04_Credential_Budget_Risk_Model.md`
4. 资金结算与平台费率：看 `docs/03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md`

## 4. 仍属于 future-state 的想法

下面这些内容仍然只算设计方向，不应当作当前网关已发布能力：

1. 基于响应头的动态按量计费。
2. Provider 主动通过 header 回传最终 charge amount。
3. 更细粒度的 token-level metering 作为对外稳定 contract。

如果这些能力后续真的落地，必须先同步更新代码、`docs/api.md` 和错误码总表，再回写这里。