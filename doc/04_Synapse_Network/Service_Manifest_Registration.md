# API 友好的服务注册设计（Service ID 系统生成）

## 1. 背景与目标

当前 Seller 在注册服务时手填 `serviceId`，容易出现：

- 重复/冲突（同钱包下命名不一致）
- 命名语义不稳定（后续重命名成本高）
- 调用方（平台或外部节点）难以仅凭 `endpoint` 推断“该怎么调用”

目标：

1. `serviceId` 改为系统生成，Seller 不再手填。
2. 注册信息里补齐 **程序可直接执行** 的调用描述（Invoke Spec）。
3. 保持与现有支付/扣款链路兼容（仍可在链上与账务中使用 `serviceId`）。
4. **明确系统映射关系**：废除繁杂的 Agent 层绑定，采用简洁的 `Seller 钱包地址 -> 多个 Service Keys (凭证) -> 所有注册的服务` 架构。

---

## 2. 关键结论

### 2.1 `serviceId` 是否系统生成？

建议：**是，必须系统生成**。

- Seller 填写“业务可读字段”（如 `serviceName`、`summary`）
- 平台生成不可变 `serviceId`（内部主键 + 对外稳定引用）

推荐格式（兼容当前大写/下划线校验）：

- `SVC_<SELLER_SHORT>_<TIME36>_<RAND4>`
- 示例：`SVC_SA_0Z8K2F_7Q3N`

约束：

- 全局唯一
- 创建后不可修改
- 在 `ownerAddress` 维度建立唯一索引

---

## 3. 调用方友好的服务注册模型

> 核心不是“一个 endpoint 字符串”，而是“完整调用契约”。Seller 的所有服务默认被统管在 `Seller 钱包地址` 麾下，通过签发多个不同限额或策略的 `Service Keys` 进行调用的鉴权与分发。

### 3.1 Seller 创建时保留字段（必填）

- `serviceName`: 服务显示名（如“获取名人名言”）
- `pricing`: 单价（USDC）
- `isActive`: 是否可调用
- `invoke.method`: HTTP 方法（`POST/GET`）
- `invoke.url`: 完整 URL（如 `http://127.0.0.1:8100/api/v1/quotes/famous`）
- `invoke.timeoutMs`: 超时（建议默认 `30000`）
- `invoke.request.contentType`: 默认 `application/json`
- `invoke.request.schema`: 输入 JSON Schema（最小可用）
- `invoke.response.schema`: 输出 JSON Schema（最小可用）

### 3.2 Seller 创建时可选字段（建议）

- `summary`: 服务一句话说明
- `tags`: 能力标签（如 `quote`, `chinese`, `inspiration`）
- `auth.type`: `none | bearer | api_key | service_key`
- `auth.headerName`: 例如 `Authorization` / `X-API-Key`
- `invoke.headersTemplate`: 固定或模板化请求头
- `invoke.examples`: 示例请求（便于 few-shot）
- `version`: `v1`、`v1.1`

### 3.3 系统生成/回填字段

- `id`: 服务记录 ID（现有字段）
- `serviceId`: 系统生成、不可变
- `ownerAddress`: 由鉴权钱包注入
- `createdAt` / `updatedAt`
- `status`: `active | inactive | archived`

---

## 4. 基于调用契约的发起方式

你的实际接口：

- `POST /api/v1/quotes/famous`
- 请求体：`{"text":"关于勇气"}`

可注册为如下调用契约（示意）：

```json
{
  "serviceName": "获取名人名言",
  "summary": "输入主题，返回一句名人名言",
  "invoke": {
    "method": "POST",
    "url": "http://127.0.0.1:8100/api/v1/quotes/famous",
    "timeoutMs": 30000,
    "request": {
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "required": ["text"],
        "properties": {
          "text": { "type": "string", "description": "主题或关键词" }
        }
      }
    },
    "response": {
      "schema": {
        "type": "object",
        "required": ["quote"],
        "properties": {
          "quote": { "type": "string" },
          "author": { "type": "string" },
          "topic": { "type": "string" }
        }
      }
    },
    "examples": [
      {
        "input": { "text": "关于勇气" },
        "expected": { "quote": "..." }
      }
    ]
  },
  "tags": ["quote", "cn", "inspiration"]
}
```

这样调用网关和接入端在运行时只需：

1. 拉取服务注册信息。
2. 按 `invoke.request.schema` 组装参数。
3. 附加对应的 `Service Key` 凭证发起请求。
4. 按 `invoke.response.schema` 解析结果。

`discover` 对外返回时，`invoke.targets[].url` 必须是平台网关地址（例如 `http://127.0.0.1:8000/api/v1/gateway/generate`），而不是卖家注册的上游地址（例如 `http://127.0.0.1:8100/...`）。卖家上游地址仅在平台内部用于转发与探活。

---

## 5. 建议的注册 API（V2）

### 5.1 Create（Seller 不再提交 `serviceId`，去除 AgentId）

`POST /api/v1/services`

请求体（示意）：

```json
{
  "serviceName": "获取名人名言",
  "role": "Provider / Seller",
  "address": "0x...",
  "pricing": {
    "currency": "USDC",
    "amount": "0.05"
  },
  "isActive": true,
  "status": "active",
  "summary": "输入主题返回名人名言",
  "tags": ["quote", "cn"],
  "auth": {
    "type": "service_key",
    "headerName": "X-Credential"
  },
  "healthCheck": {
    "path": "/health",
    "method": "GET",
    "intervalSec": 30,
    "timeoutMs": 3000,
    "successCodes": [200],
    "healthyThreshold": 2,
    "unhealthyThreshold": 3
  },
  "constraints": {
    "timeoutMs": 3000,
    "maxResponseBytes": 2048,
    "maxRequestBytes": 4096,
    "maxQps": 50
  },
  "forwarding": {
    "requestIdHeader": "X-Synapse-Request-Id",
    "passThroughHeaders": ["X-Trace-Id", "X-Client-Version"],
    "injectHeaders": {
      "X-Synapse-Service-Id": "get_famous_quotes_top3"
    },
    "retryPolicy": {
      "maxAttempts": 2,
      "backoffMs": 200,
      "retryOnStatus": [429, 500, 502, 503, 504]
    }
  },
  "metering": {
    "billingUnit": "per_call",
    "billOnError": false,
    "billableStatusClasses": [2],
    "requestIdRequired": true,
    "responseSizeMetering": true
  },
  "invoke": {
    "method": "POST",
    "url": "http://127.0.0.1:8100/api/v1/quotes/famous",
    "targets": [
      { "url": "http://127.0.0.1:8100/api/v1/quotes/famous", "weight": 100, "region": "ap-sg-1" },
      { "url": "http://127.0.0.1:8101/api/v1/quotes/famous", "weight": 80, "region": "ap-sg-2" }
    ],
    "timeoutMs": 30000,
    "request": {
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "required": ["text"],
        "properties": {
          "text": { "type": "string" }
        }
      }
    },
    "response": {
      "schema": {
        "type": "object",
        "properties": {
          "quote": { "type": "string" }
        }
      }
    }
  }
}
```

返回体（示意）：

```json
{
  "status": "success",
  "service": {
    "id": "2f3f...",
    "serviceId": "SVC_SA_0Z8K2F_7Q3N",
   "schemaVersion": 2,
    "serviceName": "获取名人名言",
   "pricing": {
    "currency": "USDC",
    "amount": "0.05"
   },
    "isActive": true,
   "status": "active",
   "healthCheck": { "...": "..." },
   "constraints": { "...": "..." },
   "forwarding": { "...": "..." },
   "metering": { "...": "..." },
    "invoke": { "...": "..." }
  }
}
```

### 5.1.1 参考 Google/AWS 的注册增强字段（建议必备）

1. **可用性字段（Availability）**
  - `invoke.targets[]`（多节点目标地址 + 权重 + 区域）
  - `healthCheck.path/method/intervalSec/timeoutMs/successCodes`
  - `healthyThreshold` / `unhealthyThreshold`
  - 作用：避免把流量打给已退化节点，提升 Buyer 成功率；支持集群多副本弹性。

2. **转发与熔断字段（Forwarding & Protection）**
  - `constraints.timeoutMs`
  - `constraints.maxRequestBytes` / `maxResponseBytes`
  - `constraints.maxQps`
  - `forwarding.retryPolicy`
  - 作用：控制资源上限、防止大包与慢请求拖垮网关。

### 5.1.3 约束参数合理区间与平台硬上限（强制）

Seller 在注册时填写的 `constraints` 不是“建议值”，而是网关执行层硬约束；平台会在注册时校验并拒绝越界值。

推荐区间（业务侧）：

1. `timeoutMs`: `1000-5000`
2. `maxRequestBytes`: `1024-16384`
3. `maxResponseBytes`: `2048-65536`
4. `maxQps`: `5-100`

平台硬上限（防止拖垮基础设施）：

1. `timeoutMs`: `300-15000`
2. `maxRequestBytes`: `256-262144`
3. `maxResponseBytes`: `256-1048576`
4. `maxQps`: `1-200`

不满足硬上限时，注册接口返回 `422 SERVICE_REGISTRATION_INVALID`。

### 5.1.4 Buyer 调用阶段约束执行（运行时）

网关在 `POST /api/v1/gateway/generate` 执行时，会基于注册时 `constraints` 对买家请求做准入控制：

1. `maxQps`：对单 `serviceId` 执行每秒窗口限流，超限返回 `429 SERVICE_QPS_EXCEEDED`。
2. `maxRequestBytes`：转发前计算请求体字节数（UTF-8），超限返回 `413 REQUEST_PAYLOAD_TOO_LARGE`。
3. `timeoutMs`：转发客户端超时严格按服务配置执行（并受平台硬上限保护）。
4. `maxResponseBytes`：上游响应超限时终止并返回 `413 RESPONSE_PAYLOAD_TOO_LARGE`。

### 5.1.5 Buyer 请求体契约校验（基于 invoke.request.schema）

平台转发层当前仅支持以下请求协议：

1. `invoke.method = POST`
2. `invoke.request.contentType = application/json`

运行时会基于 Seller 注册的 `invoke.request.schema.required` 校验必填字段是否存在。

示例：

```json
"request": {
  "contentType": "application/json",
  "schema": {
    "type": "object",
    "required": ["text"],
    "properties": {
      "text": { "type": "string" }
    }
  }
}
```

若 Buyer 请求缺少必填字段，网关返回：

1. `422 REQUEST_REQUIRED_FIELDS_MISSING`
2. 错误详情包含 `serviceId` 和 `missingFields`，用于提示“哪个服务缺哪个字段”。

### 5.1.6 Gateway 加权转发策略（基于 Seller targets）

对于 Seller 注册的：

```json
"invoke": {
  "method": "POST",
  "targets": [
    { "url": "http://127.0.0.1:8100/api/v1/quotes/famous", "weight": 100, "region": "ap-sg-1" },
    { "url": "http://127.0.0.1:8101/api/v1/quotes/famous", "weight": 80, "region": "ap-sg-2" }
  ]
}
```

网关执行规则：

1. 每次 Buyer 调用进入网关后，使用 `invoke.targets[]` 作为候选上游池。
2. 先基于 `serviceHealth.targets` 过滤健康节点，再按 `weight` 做加权随机选路（weighted random）。
3. `weight` 必须为整数且范围 `[1, 10000]`；非法配置返回 `500 INVALID_INVOKE_CONFIG`。
4. 候选池为空或 URL 全部无效时，返回 `500 INVALID_INVOKE_CONFIG`。
5. 若配置合法但当前健康节点为空，返回 `503 SERVICE_UNAVAILABLE`。

效果：

1. 权重更高的节点获得更高流量占比。
2. Seller 可通过调权实现灰度和容量迁移，无需改 Buyer 调用代码。
3. `discover` 仍仅暴露平台入口，不泄露 Seller 上游地址。

这套机制保证了：Seller 的 SLA 声明能被网关执行，Buyer 请求不会绕过安全阈值，平台资源不会被单服务失控拖垮。

3. **可观测与追踪字段（Observability）**
  - `forwarding.requestIdHeader`（标准化 `X-Synapse-Request-Id`）
  - `forwarding.passThroughHeaders`（trace 透传）
  - 作用：实现端到端追踪与工单级对账。

4. **计费字段（Metering）**
  - `metering.billingUnit`
  - `metering.billOnError`
  - `metering.billableStatusClasses`
  - `metering.responseSizeMetering`
  - 作用：确保扣费与转发结果可解释、可审计、可复算。

### 5.1.2 如何保证“注册后服务可用、安全、易接入、易统计”

1. **可用性（Service Availability）**
  - 注册时强制 `invoke.targets[]`（至少一个 URL）+ `healthCheck.path`，并在上线前做一次主动探测。
  - 平台探活地址规则：`target.url` 的 `scheme://host[:port]` + `healthCheck.path`。
  - 健康检查失败服务不进入 `discover` 可路由池。

### 5.1.2.A 平台健康检查执行与存储（已落地）

平台在 Seller API 里实现了持续探活任务，参考 Google Cloud Health Check 与 AWS Target Group Health 的执行方式：

1. 后台任务
  - 任务名：`run_service_health_monitor`
  - 执行周期：`SERVICE_HEALTH_PROBE_INTERVAL_SEC`（默认 15s）
  - 目标对象：所有 active 服务的 `invoke.targets[]`

2. 探活 URL 规则
  - `probeUrl = origin(target.url) + healthCheck.path`
  - 例：`http://127.0.0.1:8100/api/v1/quotes/famous` + `/health` => `http://127.0.0.1:8100/health`

3. 持久化字段（存储于 service 记录）
  - `serviceHealth.overallStatus`: `healthy|degraded|unhealthy|unknown`
  - `serviceHealth.healthyTargets`
  - `serviceHealth.totalTargets`
  - `serviceHealth.lastCheckedAt`
  - `serviceHealth.targets[url]`: 节点粒度的状态、连续成功/失败计数、最近健康时间、错误信息

3.1 规范化健康检查表（每个 target 一条记录）
  - 表名/集合名：`service_target_health`
  - 主键建议：`(serviceId, targetUrl)`
  - 关键字段：
    - `serviceId`
    - `targetUrl`
    - `probeUrl`（例如 `url1 + /health`）
    - `status`（`healthy|degraded|unhealthy|unknown`）
    - `overallStatus`
    - `httpStatus`
    - `latencyMs`
    - `consecutiveSuccesses`
    - `consecutiveFailures`
    - `lastCheckedAt`
    - `lastHealthyAt`
    - `error`

3.1.1 健康历史表（每次探测一条）
  - 表名/集合名：`service_target_health_history`
  - 用途：支持 Seller 侧按 `serviceId` 查询每个 target 最近 N 次探测轨迹。
  - 推荐索引：`(serviceId, targetUrl, checkedAt DESC)`

3.1.2 Seller 健康明细接口（Owner Scope）
  - `GET /api/v1/services/{serviceId}/health/history?limitPerTarget=50&days=7`
  - 返回每个 target 的最新状态 + 最近 N 次探测历史。
  - 仅服务 owner 可访问。

3.2 示例：`serviceA` 三节点
  - targets：`url1, url2, url3`
  - 健康表对应 3 条记录：
    - `url1/health -> healthy`
    - `url2/health -> degraded`
    - `url3/health -> unhealthy`
  - 网关转发：只在 healthy 节点选路，因此只会转发到 `url1`。
  - discover：`serviceA` 仍展示（因为至少 1 个 healthy 节点）。

3.3 历史数据保留策略（防表膨胀）
  - 每 target 每日探测记录量约：`86400 / probeIntervalSec`
  - 默认 `probeIntervalSec=15` => `5760` 条/target/天
  - 若 `serviceA` 有 3 个 targets：`17280` 条/天
  - 7 天约 `120960` 条；30 天约 `518400` 条
  - 推荐保留：`7 天`（足够排障且显著节约存储成本）
  - 系统会自动：
    1. 清理超过 retention 的历史
    2. 清理已删除 service 的 orphan 历史

4. Discover 准入
  - 仅返回满足 `isActive=true` 且 `healthyTargets>=1` 的服务。
  - discover 响应中的 `status` 为健康可用性状态，而非卖家配置态。

5. 网关转发
  - 默认 `FORWARDING_REQUIRE_HEALTHY_TARGETS=true`
  - 仅在健康节点集合内选路；无健康节点时返回 `503 SERVICE_UNAVAILABLE`

这保证了：
1. `http://localhost:3000/dashboard/discover` 看到的是实时探活状态，不是静态占位文案。
2. discover 的可见性与真实转发行为一致，不会出现“看起来可用但被路由到坏节点”。

2. **安全性（Security）**
  - `auth.type=service_key` 且要求请求带 `X-Credential`。
  - 网关注入 `X-Synapse-Request-Id`，卖家端必须落库该请求号用于幂等与审计。
  - 通过 `maxRequestBytes/maxResponseBytes` 防止 payload 滥用。

3. **Buyer 易接入（Developer Experience）**
  - 保证 `invoke.request.schema` / `invoke.response.schema` 最小可用。
  - 提供 `invoke.examples`，让模型可直接 few-shot 调用。

4. **平台可统计、可扣费、可转发（Ops & Billing）**
  - 统一 `requestId` 作为路由、账单、审计主键。
  - `metering` 明确哪些状态码计费、错误是否计费。
  - `forwarding.retryPolicy` 保证重试行为可预测，避免重复扣费。

### 5.1.7 注册字段说明（字段含义 + 平台使用方式）

1. `serviceName`
  - 含义：人类可读服务名。
  - 平台使用：控制台展示、发现页标题、路由候选可读标签。

2. `pricing.currency` / `pricing.amount`
  - 含义：计费币种与单价。
  - 平台使用：扣费引擎计算单次调用应扣金额，账单聚合展示。

3. `isActive` / `status`
  - 含义：服务可用开关与生命周期状态。
  - 平台使用：`discover` 仅暴露 active；inactive/archived 不参与转发。

4. `auth`
  - 含义：卖家节点期望的认证方式（如 `service_key`）。
  - 平台使用：网关在转发时注入相应头部，阻止未授权调用。

5. `invoke.method`
  - 含义：上游调用 HTTP 方法。
  - 平台使用：转发引擎按该方法发起请求。

6. `invoke.targets[]`
  - 含义：集群目标地址列表，可带 `weight`、`region`。
  - 平台使用：按权重路由流量，支持同服务多节点高可用。

7. `invoke.timeoutMs`
  - 含义：单次转发超时。
  - 平台使用：超时熔断与失败计数，防止慢请求拖垮资源池。

8. `invoke.request.schema` / `invoke.response.schema`
  - 含义：输入/输出 JSON 契约。
  - 平台使用：调用前参数校验与调用后结构校验，提升 Buyer 接入成功率。

9. `healthCheck.path`
  - 含义：统一探活路径（不是完整 URL）。
  - 平台使用：针对每个 target 组装 `origin + path` 执行健康检查。

10. `constraints.maxRequestBytes` / `maxResponseBytes` / `maxQps`
  - 含义：请求大小、响应大小、QPS 上限。
  - 平台使用：网关限流/限包策略和安全防护阈值。

11. `forwarding.requestIdHeader`
  - 含义：请求追踪头名（默认 `X-Synapse-Request-Id`）。
  - 平台使用：对账主键贯穿路由、计费、审计全链路。

12. `forwarding.passThroughHeaders` / `injectHeaders`
  - 含义：透传或网关注入的转发头。
  - 平台使用：保留 trace、环境信息，并注入服务上下文。

13. `forwarding.retryPolicy`
  - 含义：失败重试策略。
  - 平台使用：仅对可重试状态码进行有限重试，避免无限重放。

14. `metering.billingUnit` / `billOnError` / `billableStatusClasses`
  - 含义：计费单位、错误是否计费、哪些状态码计费。
  - 平台使用：扣费决策引擎，保证账单可解释可审计。

15. `metering.requestIdRequired` / `responseSizeMetering`
  - 含义：是否强制请求号、是否按响应大小参与计量。
  - 平台使用：防重复扣费与容量/成本精细化核算。

### 5.2 Update（不允许改 `serviceId`）

`PUT /api/v1/services/{id}`

- 允许改：`serviceName/pricing/isActive/summary/tags/invoke`
- 禁止改：`serviceId/ownerAddress/createdAt`

### 5.3 Discover（对外只暴露平台调用地址）

`GET /api/v1/services/discover?intent=名人名言`

响应示意：

```json
{
  "status": "success",
  "services": [
    {
      "serviceId": "SVC_F8_5800A9_0648",
      "serviceName": "获取名人名言 Top3",
      "pricing": "1",
      "summary": "输入主题或关键词，返回相关的前三名名人名言。",
      "tags": ["quote", "inspiration", "chinese", "famous"],
      "invoke": {
        "method": "POST",
        "targets": [
          {
            "url": "http://127.0.0.1:8000/api/v1/gateway/generate",
            "weight": 100,
            "region": null
          }
        ],
        "timeoutMs": 3000,
        "request": {
          "contentType": "application/json",
          "schema": {
            "type": "object",
            "required": ["text"]
          }
        }
      }
    }
  ],
  "count": 1
}
```

说明：
1. Buyer 只看到平台入口地址，调用统一进入平台网关。
2. 网关根据 `serviceId` 进行内部转发、扣费与审计。
3. 卖家注册的 `invoke.targets[]` 原始地址不会在 discover 对外泄露。

---

## 6. 前端创建页建议（MVP）

`Register Service` 表单字段建议：

- `Service Name`
- `Pricing`
- `Endpoint URL`
- `HTTP Method`
- `Input Schema (JSON)`（先文本域）
- `Output Schema (JSON)`（先文本域）
- `Status`

页面行为：

- 彻底去除 `Agent` 相关的选择框或绑定关系。
- 不展示可编辑 `serviceId` 输入框。
- 创建成功后在结果卡片展示只读 `serviceId`。
- 支持“复制 serviceId”按钮（供对账/排障）。

### 6.1 Artificial Intelligence Interface 必填与业务校验规则

为了保证服务注册在被 AI Buyer 调用时具备稳定路由语义，`Artificial Intelligence Interface` 必须执行以下校验：

1. `Service Name`
  - 必填
  - 长度：`4-80` 字符

2. `Agent Tool Name`
  - 必填
  - 长度：`3-64` 字符
  - 正则：`^[a-z0-9_-]+$`
  - 说明：仅允许小写字母、数字、下划线、短横线，避免跨模型工具调用兼容问题。

3. `Description (Trigger Condition)`
  - 必填
  - 长度：`12-240` 字符
  - 说明：过短描述会导致路由匹配弱、误调用率上升。

4. `Semantic Intents (Tags)`
  - 必填，至少 `1` 个标签
  - 最多 `8` 个标签
  - 单标签正则：`^[a-z0-9_-]{2,24}$`
  - 去重规则：不允许重复标签

5. 部署门禁
  - 只要上述任一规则未通过，`Deploy Manifest` 按钮必须保持禁用，并在页面提示第一条校验失败原因。

### 6.2 注册页体验重构（Google / AWS / Apple 风格）

1. 交互目标
  - 从“规则堆叠”升级为“就地理解 + 就地修正”。
  - 让卖家在 1 屏内完成核心注册，不被冗余信息打断。

2. 设计原则
  - Google 风格：字段旁上下文帮助（contextual help）。
  - AWS 风格：按业务域分组（AI Interface / Routing / Limits / Schema）。
  - Apple 风格：减少视觉噪音，突出主要任务按钮与就绪状态。

3. 已实现方案
  - 移除顶部集中校验块，改为每个字段下方展示即时校验结果。
  - 每个核心字段旁提供引导入口（点击/悬停可查看：字段作用、配置方法、平台用途、示例）。
  - 统一以 `invoke.targets[]` 作为上游配置入口，不再展示重复 endpoint 输入。
  - 右侧预览区精简为“部署就绪度 + Manifest JSON”，去掉冗长的发布注释卡片。

4. 后端契约支持
  - 新增 `GET /api/v1/services/registration-guide`。
  - 返回字段说明元数据（`key/title/description/howToConfigure/platformUse/example`），用于前端引导与后续 i18n 扩展。

---

## 7. 与现有系统兼容策略

1. 直接停用未带版本号的旧接口：`/api/services*` 不再使用。
2. 前端与后端统一使用新版模型：`POST /api/v1/services`、`PUT /api/v1/services/{id}`。
3. 服务注册请求体统一为新契约。
4. 扣款/结算/账单继续使用系统生成的 `serviceId` 作为稳定关联键。

---

## 8. 平台全生命周期调用与对账协议 (The `requestId` 追溯机制)

为了对标 Google Cloud、Stripe 等一线 API 大厂的安全极简设计，我们在“服务调用与计费链条”上做彻底剥离，防范重放/漏重调用风险：

**核心原则：** 
买家发起 `buy` 请求平台，指定 `serviceId`。一切操作建立在全局唯一 `requestId` 作为审计追踪的生命线，贯穿请求从发起到交割的全部周期。

1. **请求建立与唯一凭证分发**：
   买家调用发起，网关随即生成（或接收客户端发来的）统一 `requestId` (UUIDv4)。
2. **中心化双重校验与限流日志**：
   平台记录该请求日志信息，包含 `requestId`、`serviceId`。网关检查请求关联的 `Service Key` 执行限流配置（RPM等）并校验底层账户余额。
3. **透传标识 (Gateway -> Seller)**：
   验证通过放标后，平台往 Seller 服务 endpoint 发送真实服务内容，并**在请求 Header 携带该单的 `X-Synapse-Request-Id`**（以及用于防伪验签的防篡改签名）。
4. **卖家节点履约验证 (Seller)**：
   **卖家必须接收网关转发的 `requestId`，并将其记录在本地流水中**，以此唯一标识业务处理的发生（防御高并发重试引发的多扣费与多执行）。一旦给出成功执行结果（如 `200 OK`），平台内部扣费逻辑闭环。
5. **对账与审计 (Auditing)**：
   后期任何费用对账、申诉核查，业务层不再直接卷入资金讨论，双方只凭全局唯一的 `requestId` 比对是否确有这一笔网关路由。一单必定只有且只有一个 RequestId 对应。

---

## 9. 落地总结

**从产品层面、API网关到 Seller 落地模型，全面剪除中间 Agent 的层级复杂度，只保留：** 
`Seller Wallet (资产账本)` -> `配签的 Service Keys (调用鉴权控制)` -> `Services (实际模型处理)`。
在调用路径中贯入 `requestId` 进行幂等追查，构筑兼具简单与防超扣安全的企业级 API 结算网关。
