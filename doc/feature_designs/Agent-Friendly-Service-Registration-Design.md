# Agent 友好的服务注册设计（Service ID 系统生成）

## 1. 背景与目标

当前 Seller 在注册服务时手填 `serviceId`，容易出现：

- 重复/冲突（同钱包、同 Agent 下命名不一致）
- 命名语义不稳定（后续重命名成本高）
- Agent 难以仅凭 `endpoint` 推断“该怎么调用”

目标：

1. `serviceId` 改为系统生成，Seller 不再手填。
2. 注册信息里补齐 **Agent 可直接执行** 的调用描述（Invoke Spec）。
3. 保持与现有支付/扣款链路兼容（仍可在链上与账务中使用 `serviceId`）。

---

## 2. 关键结论

### 2.1 `serviceId` 是否系统生成？

建议：**是，必须系统生成**。

- Seller 填写“业务可读字段”（如 `serviceName`、`summary`）
- 平台生成不可变 `serviceId`（内部主键 + 对外稳定引用）

推荐格式（兼容当前大写/下划线校验）：

- `SVC_<AGENT_SHORT>_<TIME36>_<RAND4>`
- 示例：`SVC_SA_0Z8K2F_7Q3N`

约束：

- 全局唯一
- 创建后不可修改
- 在 `ownerAddress + agentId` 维度建立唯一索引

---

## 3. Agent 友好的服务注册模型

> 面向 Agent 的核心不是“一个 endpoint 字符串”，而是“完整调用契约”。

### 3.1 Seller 创建时保留字段（必填）

- `agentId`: 归属 Agent
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
- `auth.type`: `none | bearer | api_key | agent_credential`
- `auth.headerName`: 例如 `Authorization` / `X-API-Key`
- `invoke.headersTemplate`: 固定或模板化请求头
- `invoke.examples`: 示例请求（便于 Agent few-shot）
- `version`: `v1`、`v1.1`

### 3.3 系统生成/回填字段

- `id`: 服务记录 ID（现有字段）
- `serviceId`: 系统生成、不可变
- `ownerAddress`: 由鉴权钱包注入
- `createdAt` / `updatedAt`
- `status`: `active | inactive | archived`

---

## 4. 基于你给的接口，如何让 Agent 知道怎么调用

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

这样 Agent 在运行时无需猜测字段名，只需：

1. 拉取服务注册信息。
2. 按 `invoke.request.schema` 组装参数。
3. 按 `invoke.method + invoke.url` 发请求。
4. 按 `invoke.response.schema` 解析结果。

---

## 5. 建议的注册 API（V2）

### 5.1 Create（Seller 不再提交 `serviceId`）

`POST /api/v2/services`

请求体（示意）：

```json
{
  "agentId": "seller-agent",
  "serviceName": "获取名人名言",
  "role": "Provider / Seller",
  "address": "0x...",
  "pricing": "0.05",
  "isActive": true,
  "summary": "输入主题返回名人名言",
  "tags": ["quote", "cn"],
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
    "agentId": "seller-agent",
    "serviceName": "获取名人名言",
    "pricing": "0.05",
    "isActive": true,
    "invoke": { "...": "..." }
  }
}
```

### 5.2 Update（不允许改 `serviceId`）

`PUT /api/v2/services/{id}`

- 允许改：`serviceName/pricing/isActive/summary/tags/invoke`
- 禁止改：`serviceId/ownerAddress/createdAt`

---

## 6. 前端创建页建议（MVP）

`Register Service` 表单字段建议：

- `Agent`
- `Service Name`
- `Pricing`
- `Endpoint URL`
- `HTTP Method`
- `Input Schema (JSON)`（先文本域）
- `Output Schema (JSON)`（先文本域）
- `Status`

页面行为：

- 不展示可编辑 `serviceId` 输入框
- 创建成功后在结果卡片展示只读 `serviceId`
- 支持“复制 serviceId”按钮（供对账/排障）

---

## 7. 与现有系统兼容策略

1. 直接停用旧接口：`/api/v1/services*` 不再使用。
2. 前端与后端统一使用：`POST /api/v2/services`、`PUT /api/v2/services/{id}`、`DELETE /api/v2/services/{id}`、`GET /api/v2/services`。
3. 服务注册请求体统一为新契约：`serviceName + pricing + isActive + invoke(...)`。
4. 扣款/结算/账单继续使用系统生成的 `serviceId` 作为稳定关联键。

---

## 8. Agent 执行侧最小协议（建议）

Agent 拿到服务后，按以下顺序执行：

1. 校验 `isActive == true`
2. 校验 `auth` 需求并注入凭证
3. 按 `invoke.request.schema` 校验输入
4. 发起 HTTP 调用（超时使用 `invoke.timeoutMs`）
5. 按 `invoke.response.schema` 解析
6. 记录 `request_id + serviceId + status + latency_ms`

---

## 9. 一句话落地建议

- 现在就可执行：**先在产品与接口层废除手填 `serviceId`，改为后端生成；同时在注册模型加入 `invoke` 契约字段。**
- 这样你的 Agent 能“看文档即调用”，而不是“猜字段名调用”。
