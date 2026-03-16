# Service Manifest 字段标准

> 目标：定义卖家挂载服务时必须提交的结构化 Manifest，让 Agent 与 Gateway 都能可靠消费。

## 1. 设计原则

Manifest 不是广告页，它是 Agent 与 Gateway 共同消费的服务契约。

它必须同时满足三件事：

1. Agent 能理解何时调用
2. Gateway 能理解如何计费和路由
3. Seller 能声明 SLA 和能力边界

## 2. 字段分层

### 2.1 身份字段

- `service_id`
- `service_name`
- `service_slug`
- `seller_id`
- `manifest_version`
- `status`

### 2.1.1 平台内部结算字段（不暴露给 Agent）

- `seller_wallet`
- `settlement_account_id`
- `payout_policy_id`

说明：

- `seller_wallet` 是平台内部结算和卖家归属映射字段，不是 Agent Runtime 做服务选择所必需的信息。
- 对 Discovery / Quote / Invoke 的公开返回，默认不暴露 `seller_wallet`。
- Agent 只需要知道 `service_id`、能力、价格、输入输出、运行约束，不需要知道卖家的链上收款地址。

### 2.2 Agent 理解字段

- `description_for_model`
- `task_category`
- `capabilities`
- `input_schema`
- `output_schema`
- `examples`
- `limitations`
- `supported_languages`

### 2.3 商业字段

- `price_model`
- `base_price_usdc`
- `unit_name`
- `min_billable_unit`
- `quote_required`
- `settlement_currency`

### 2.4 运行字段

- `endpoint_url`
- `auth_mode`
- `timeout_ms`
- `streaming_supported`
- `async_supported`
- `callback_supported`
- `max_payload_bytes`

### 2.5 质量字段

- `availability_slo`
- `p95_latency_ms`
- `success_rate_24h`
- `region`
- `compliance_tags`

## 3. 推荐 JSON 结构

```json
{
  "service_id": "svc_ocr_th_invoice",
  "service_name": "SEA Invoice OCR",
  "manifest_version": "1.0.0",
  "status": "active",
  "model_usage": {
    "description_for_model": "Extract structured fields from Southeast Asia invoices.",
    "task_category": "ocr.invoice",
    "capabilities": ["merchant_extraction", "amount_extraction"],
    "limitations": ["not for handwritten receipts"],
    "examples": [
      {
        "input": {"image_url": "https://..."},
        "output": {"invoice_total": "1820.50", "currency": "THB"}
      }
    ]
  },
  "io_schema": {
    "input_schema": {},
    "output_schema": {}
  },
  "billing": {
    "price_model": "fixed",
    "base_price_usdc": "0.008",
    "quote_required": true,
    "settlement_currency": "USDC"
  },
  "runtime": {
    "endpoint_url": "https://seller.example.com/invoke",
    "timeout_ms": 15000,
    "streaming_supported": false,
    "async_supported": false,
    "max_payload_bytes": 4000000
  },
  "quality": {
    "availability_slo": 0.995,
    "p95_latency_ms": 820,
    "region": ["ap-southeast-1"]
  }
}
```

说明：

- 上面这份 JSON 是**公开给 Agent Runtime 消费的 Manifest 结构**。
- 卖家钱包地址、结算账户、分账规则这类字段，应该保留在平台内部 Seller Profile / Settlement Profile 中，由 Gateway 在扣费和结算时使用。
- 对买家 Agent 来说，真正重要的是 `service_id`、`description_for_model`、`input_schema`、`output_schema`、`price_model`、`endpoint_url` 和运行约束。

## 4. Manifest 校验规则

Gateway 在卖家提交 Manifest 时，必须校验：

1. `service_id` 全局唯一
2. `description_for_model` 不得为空
3. `input_schema` / `output_schema` 必须是合法 JSON Schema
4. `price_model` 必须命中白名单
5. `endpoint_url` 必须可健康检查
6. `timeout_ms`、`max_payload_bytes` 必须在平台限制内

补充原则：

- Seller 的链上身份和收款信息在平台内部完成绑定，不进入面向 Agent 的公开契约。
- 公开 Manifest 只保留“调用所需信息”，不泄露与调用无关的卖家结算信息。

## 5. V1 最小必填集

V1 先强制这些字段：

- `service_id`
- `service_name`
- `description_for_model`
- `input_schema`
- `output_schema`
- `price_model`
- `base_price_usdc`
- `endpoint_url`
- `timeout_ms`
- `status`

其余字段可以逐步丰富，但这几个缺一不可。

## 6. 设计结论

Manifest 不是卖家自由发挥的介绍页，而是平台的结构化合同。

谁想让 Agent 自动调用，谁就必须把能力、价格、输入输出、运行约束说清楚。

同时要记住：**Manifest 是 Service Contract，不是 Seller Profile。**