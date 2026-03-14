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

---

## 5. 建议的注册 API（V2）

### 5.1 Create（Seller 不再提交 `serviceId`，去除 AgentId）

`POST /api/v2/services`

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
    "url": "http://127.0.0.1:8100/health",
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
  - `healthCheck.url/method/intervalSec/timeoutMs/successCodes`
  - `healthyThreshold` / `unhealthyThreshold`
  - 作用：避免把流量打给已退化节点，提升 Buyer 成功率。

2. **转发与熔断字段（Forwarding & Protection）**
  - `constraints.timeoutMs`
  - `constraints.maxRequestBytes` / `maxResponseBytes`
  - `constraints.maxQps`
  - `forwarding.retryPolicy`
  - 作用：控制资源上限、防止大包与慢请求拖垮网关。

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
  - 注册时强制 `invoke.url` + `healthCheck`，并在上线前做一次主动探测。
  - 健康检查失败服务不进入 `discover` 可路由池。

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

### 5.2 Update（不允许改 `serviceId`）

`PUT /api/v2/services/{id}`

- 允许改：`serviceName/pricing/isActive/summary/tags/invoke`
- 禁止改：`serviceId/ownerAddress/createdAt`

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

---

## 7. 与现有系统兼容策略

1. 直接停用旧接口：`/api/v1/services*` 不再使用。
2. 前端与后端统一使用新版模型：`POST /api/v2/services`、`PUT /api/v2/services/{id}`。
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
