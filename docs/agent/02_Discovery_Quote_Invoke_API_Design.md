# Discovery / Quote / Invoke API 设计

> 目标：定义 Agent Runtime 的三段式调用协议，让 Agent 能稳定完成 discover -> quote -> invoke。

## 1. 设计原则

这三类 API 优先服务 Agent Runtime，而不是前端页面。

设计原则：

1. 结构化优先，禁止语义模糊
2. 幂等优先，避免重复扣费
3. 机器可执行优先，不是给人眼阅读优先
4. 风控前置，能在 Quote 阶段拦就不要拖到 Invoke
5. 错误码稳定，便于 Agent 编排重试与降级

补充边界：

- Discovery / Quote / Invoke 是 **service-facing / agent-facing protocol**。
- 这三类 API 默认不暴露卖家钱包、平台分账明细、内部路由节点、内部账本主键。
- Agent 只需要知道“调用什么服务、花多少钱、是否允许调用、返回什么结果”。

## 2. Discovery API

### 2.1 Endpoint

`POST /api/v1/agent/discovery/search`

### 2.2 Request

```json
{
  "query": "cheap OCR for SEA invoices",
  "tags": ["ocr", "invoice"],
  "page": 1,
  "pageSize": 10,
  "sort": "best_match"
}
```

说明：

1. V1 Agent Discovery 请求支持 `query`、`tags`、`page`、`pageSize`、`sort`。
2. `query` 和 `tags` 采用并集语义，命中任一侧即可进入候选集合。
3. `tags` 采用任一命中策略，不要求请求中的 tags 全部命中。
4. `query` 的搜索面至少应覆盖 `service_id`、`service_name`、`description_for_model` 和 tags 文本。
5. 当 `query` 为空字符串或未传时，接口应返回当前所有健康可 discover 的服务。
6. `pageSize` 是唯一的页大小控制字段，客户端和 SDK 不再发送 `limit`。

### 2.3 Response

```json
{
  "request_id": "disc_01J...",
  "page": 1,
  "pageSize": 10,
  "totalCount": 42,
  "hasMore": true,
  "results": [
    {
      "service_id": "svc_ocr_th_invoice",
      "service_name": "SEA Invoice OCR",
      "description_for_model": "Extract merchant, tax, total and date from SEA invoices.",
      "price_model": {
        "type": "fixed",
        "amount_usdc": "0.008"
      },
      "quote_required": true,
      "health_score": 98,
      "p95_latency_ms": 820,
      "success_rate_24h": 0.992,
      "output_mode": "json_schema",
      "service_reliability_tier": "A",
      "manifest_version": "1.0.0"
    }
  ],
  "count": 10
}
```

### 2.4 关键要求

- 返回结果必须已经带上 Agent 决策所需核心字段
- 不允许把关键字段藏在长文本介绍里
- `sort` 至少支持 `best_match`、`lowest_price`、`fastest`、`highest_reliability`
- 排序和展示应该以 service 健康度、价格、能力为中心，而不是暴露卖家身份细节

### 2.5 Console Discovery 与 Agent Discovery 必须分层

控制台页面和 Agent Runtime 都会消费同一个 service catalog，但不应该共用同一个 HTTP contract。

推荐拆分方式：

1. `GET /api/v1/services/discover`
  面向控制台与公开浏览页，返回更适合人类阅读的列表结果，可按页面需要做轻量搜索、分页，以及 `price / invocation_count / revenue / health / service_name` 排序。
2. `POST /api/v1/agent/discovery/search`
  面向 Agent Runtime / SDK，返回严格结构化的机器协议结果，V1 请求保留 `query`、`tags`、`page`、`pageSize`、`sort`，让分页语义保持单一且稳定。

约束：

1. 底层 ranking / filtering / discoverability 逻辑应复用同一套 registry service，禁止维护两套 discover 真相。
2. 上层 response shape 必须分开，避免控制台临时字段污染 agent contract。
3. 人类页面允许做视觉增强与本地分页；agent 协议必须保持字段稳定、语义稳定、错误码稳定。

## 3. Quote API

### 3.1 Endpoint

`POST /api/v1/agent/quotes`

### 3.2 Quote 必须回答的问题

1. 这次调用预计多少钱
2. 当前 Credential 能不能承受
3. 是否需要额外条件，比如异步回调或大文件上传
4. 这次调用的价格锁定多久

### 3.3 Request

```json
{
  "service_id": "svc_ocr_th_invoice",
  "credential_id": "cred_01J...",
  "input_preview": {
    "document_count": 1,
    "file_type": "image/png"
  },
  "response_mode": "sync"
}
```

### 3.4 Response

```json
{
  "quote_id": "quote_01J...",
  "service_id": "svc_ocr_th_invoice",
  "price_usdc": "0.008",
  "price_model": "fixed",
  "budget_check": {
    "allowed": true,
    "remaining_budget_usdc": "4.212",
    "remaining_daily_limit_usdc": "0.792"
  },
  "expires_at": "2026-03-17T12:00:00Z",
  "idempotency_scope": "quote_id",
  "invoke_constraints": {
    "max_payload_bytes": 4000000,
    "timeout_ms": 15000
  }
}
```

### 3.5 关键要求

- Quote 必须短 TTL，避免价格漂移和策略漂移
- Quote 响应必须能直接成为 Invoke 的输入凭证之一
- `budget_check.allowed=false` 时，不得建议继续 Invoke

## 4. Invoke API

### 4.1 Endpoint

`POST /api/v1/agent/invocations`

### 4.2 Request

```json
{
  "quote_id": "quote_01J...",
  "credential_id": "cred_01J...",
  "idempotency_key": "task-8891-step-2",
  "payload": {
    "image_url": "https://.../invoice.png"
  },
  "response_mode": "sync"
}
```

### 4.3 Success Response

```json
{
  "invocation_id": "inv_01J...",
  "status": "SUCCEEDED",
  "charged_usdc": "0.008",
  "result": {
    "merchant_name": "ABC CO LTD",
    "invoice_total": "1820.50",
    "currency": "THB"
  },
  "receipt_id": "rcpt_01J..."
}
```

说明：

- `provider_payout_usdc`、`platform_fee_usdc` 属于平台内部结算与财务拆账字段，不应该成为 Agent-facing 成功响应的默认字段。
- 如果 Owner 需要看平台费用和卖家分账，应在 Billing / Audit 查询接口中获取，而不是塞进每次 Invoke 响应。

### 4.4 Failure Response

```json
{
  "invocation_id": "inv_01J...",
  "status": "FAILED_FINAL",
  "error": {
    "code": "BUDGET_EXHAUSTED",
    "message": "Credential remaining budget is lower than quote amount.",
    "retryable": false,
    "action": "reduce_scope_or_recharge"
  }
}
```

## 5. 错误码分层

这份文档描述的是 Agent Runtime 的目标协议面，不等于当前 Gateway 已经完整落地的错误码全集。

为了避免和当前实现混淆，这里明确拆成两层：

1. **Current implemented baseline**
  当前对外可依赖的错误码，以 `docs/06_Reference/05_Runtime_API_Contract.md` 和 `docs/06_Reference/06_Runtime_Error_Code_Catalog.md` 中已经对齐到代码实现的集合为准。
2. **Future-state target taxonomy**
  下面列出的目标态错误码分层，用于约束后续 Runtime 演进方向，不代表当前网关都已经支持。

### 5.1 Current implemented baseline

当前 Gateway 已经明确落地、可供 SDK / Frontend / Agent Runtime 依赖的错误码，至少包括以下几组：

1. **Credential / Auth**
  `CREDENTIAL_REQUIRED` `CREDENTIAL_FORMAT_INVALID` `CREDENTIAL_INVALID` `CREDENTIAL_INACTIVE` `CREDENTIAL_EXPIRED`
2. **Quote / Invocation State**
  `QUOTE_NOT_FOUND` `QUOTE_CREDENTIAL_MISMATCH` `QUOTE_EXPIRED` `QUOTE_NOT_INVOKABLE` `INVOCATION_FORBIDDEN` `IDEMPOTENCY_CONFLICT`
3. **Budget / Risk Guardrails**
  `BUDGET_EXHAUSTED` `DAILY_LIMIT_EXCEEDED` `PER_INVOCATION_CAP_EXCEEDED` `CREDENTIAL_MAX_CALLS_EXCEEDED` `CREDENTIAL_RPM_EXCEEDED` `CREDENTIAL_CREDIT_LIMIT_EXCEEDED` `SERVICE_QPS_EXCEEDED`
4. **Execution / Payload Constraints**
  `SERVICE_NOT_FOUND` `SERVICE_INACTIVE` `SERVICE_UNAVAILABLE` `INVALID_SERVICE_PRICE` `INVALID_INVOKE_CONFIG` `REQUEST_REQUIRED_FIELDS_MISSING` `REQUEST_PAYLOAD_TOO_LARGE` `RESPONSE_PAYLOAD_TOO_LARGE` `UPSTREAM_ERROR`

约束说明：

- 这批错误码是当前 V1 Runtime 的真实 contract，优先级高于目标态枚举。
- Agent 的自动重试、降级、终止逻辑，应该只依赖这批已发布错误码与 `docs/06_Reference/05_Runtime_API_Contract.md` 当前语义。
- 如果未来新增错误码，必须先在代码、`docs/06_Reference/05_Runtime_API_Contract.md`、`docs/06_Reference/06_Runtime_Error_Code_Catalog.md` 三处同步，再把这里的 future-state 项目提升为 current baseline。

### 5.2 Future-state target taxonomy

目标态要求错误码至少分四层：

1. **Auth Layer**
  `INVALID_CREDENTIAL` `CREDENTIAL_REVOKED` `CREDENTIAL_EXPIRED`
2. **Risk Layer**
  `BUDGET_EXHAUSTED` `DAILY_LIMIT_EXCEEDED` `RATE_LIMITED` `SCOPE_DENIED`
3. **Quote Layer**
  `QUOTE_EXPIRED` `PRICE_CHANGED` `QUOTE_NOT_FOUND`
4. **Execution Layer**
  `UPSTREAM_TIMEOUT` `UPSTREAM_5XX` `INVALID_PROVIDER_RESPONSE` `IDEMPOTENCY_CONFLICT`

未来态补充说明：

- `RATE_LIMITED`、`SCOPE_DENIED`、`PRICE_CHANGED`、`UPSTREAM_TIMEOUT`、`UPSTREAM_5XX`、`INVALID_PROVIDER_RESPONSE` 当前仍应视为目标态占位符。
- 这些错误码只有在网关实现、测试、API 文档和错误码总表全部同步后，才能升级为对外稳定 contract。

## 6. 幂等与审计要求

- Quote 以 `quote_id` 做短期唯一标识
- Invoke 以 `idempotency_key + credential_id` 做业务幂等
- 每次 Invoke 必须落审计事件、账本事件、调用结果事件
- `charged_usdc` 为 0 的失败调用，也要有可检索审计记录
- 审计里可以保留卖家、分账、路由细节；公开响应只返回 Agent 编排所需最小字段

## 7. V1 交付标准

V1 必须保证：

- Discovery 能返回可决策对象，而不是营销卡片
- Quote 能完成预算预检查
- Invoke 能保证幂等和结构化错误返回
- Agent 能基于错误码自动决定重试、降级还是终止