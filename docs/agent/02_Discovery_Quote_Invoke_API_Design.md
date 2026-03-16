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

## 2. Discovery API

### 2.1 Endpoint

`POST /api/v1/agent/discovery/search`

### 2.2 Request

```json
{
  "query": "cheap OCR for SEA invoices",
  "tags": ["ocr", "invoice"],
  "max_price_usdc": "0.02",
  "requires_structured_output": true,
  "region": "ap-southeast-1",
  "limit": 10,
  "sort": "best_match"
}
```

### 2.3 Response

```json
{
  "request_id": "disc_01J...",
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
      "seller_reputation": 4.8,
      "manifest_version": "1.0.0"
    }
  ]
}
```

### 2.4 关键要求

- 返回结果必须已经带上 Agent 决策所需核心字段
- 不允许把关键字段藏在长文本介绍里
- `sort` 至少支持 `best_match`、`lowest_price`、`fastest`、`highest_reliability`

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
  "seller_payout_usdc": "0.0072",
  "platform_fee_usdc": "0.0008",
  "result": {
    "merchant_name": "ABC CO LTD",
    "invoice_total": "1820.50",
    "currency": "THB"
  },
  "receipt_id": "rcpt_01J..."
}
```

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

必须至少分四层：

1. **Auth Layer**
   `INVALID_CREDENTIAL` `CREDENTIAL_REVOKED` `CREDENTIAL_EXPIRED`
2. **Risk Layer**
   `BUDGET_EXHAUSTED` `DAILY_LIMIT_EXCEEDED` `RATE_LIMITED` `SCOPE_DENIED`
3. **Quote Layer**
   `QUOTE_EXPIRED` `PRICE_CHANGED` `QUOTE_NOT_FOUND`
4. **Execution Layer**
   `UPSTREAM_TIMEOUT` `UPSTREAM_5XX` `INVALID_SELLER_RESPONSE` `IDEMPOTENCY_CONFLICT`

## 6. 幂等与审计要求

- Quote 以 `quote_id` 做短期唯一标识
- Invoke 以 `idempotency_key + credential_id` 做业务幂等
- 每次 Invoke 必须落审计事件、账本事件、调用结果事件
- `charged_usdc` 为 0 的失败调用，也要有可检索审计记录

## 7. V1 交付标准

V1 必须保证：

- Discovery 能返回可决策对象，而不是营销卡片
- Quote 能完成预算预检查
- Invoke 能保证幂等和结构化错误返回
- Agent 能基于错误码自动决定重试、降级还是终止