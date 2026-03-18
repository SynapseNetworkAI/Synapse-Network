# Service Manifest 字段标准

> 目标：定义 Provider 挂载服务时必须提交的结构化 Manifest，让 Agent 与 Gateway 都能可靠消费。

## 1. 设计原则

Manifest 不是广告页，它是 Agent 与 Gateway 共同消费的服务契约。

它必须同时满足三件事：

1. Agent 能理解何时调用
2. Gateway 能理解如何计费和路由
3. Provider 能声明 SLA 和能力边界

## 2. 字段分层

### 2.1 身份字段

- `service_id`
- `service_name`
- `service_slug`
- `provider_id`
- `manifest_version`
- `status`

### 2.1.1 平台内部结算字段（不暴露给 Agent）

- `provider_wallet`
- `settlement_account_id`
- `payout_policy_id`

说明：

- `provider_wallet` 是平台内部结算和 Provider 归属映射字段，不是 Agent Runtime 做服务选择所必需的信息。
- 对 Discovery / Quote / Invoke 的公开返回，默认不暴露 `provider_wallet`。
- Agent 只需要知道 `service_id`、能力、价格、输入输出、运行约束，不需要知道 Provider 的链上收款地址。

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

### 2.6 平台内部运行扩展字段（Implementation Extension）

这些字段主要给 Gateway 控制面、健康检查、路由与计费使用，不属于 Agent 做服务选择时必须消费的最小公开契约。

- `health_check`
- `routing_targets`
- `forwarding_policy`
- `metering_policy`
- `rate_limit_policy`

说明：

- 这组字段可以作为 Provider 提交 Manifest 时的内部扩展 block 存在。
- Discovery / Quote / Invoke 对 Agent 的公开结果，默认不直接暴露这些内部执行细节。
- 它们服务的是 Gateway 如何探活、如何转发、如何限流、如何计费，而不是 Agent 如何理解能力。

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
    "settlement_currency": "USDC"
  },
  "runtime": {
    "endpoint_url": "https://provider.example.com/invoke",
    "timeout_ms": 15000,
    "streaming_supported": false,
    "async_supported": false,
    "max_payload_bytes": 4000000
  },
  "gateway_extensions": {
    "health_check": {
      "method": "GET",
      "path": "/health",
      "interval_sec": 10,
      "timeout_ms": 3000,
      "success_codes": [200]
    },
    "routing_targets": [
      {
        "url": "https://provider.example.com/invoke",
        "weight": 100,
        "region": "ap-southeast-1"
      }
    ],
    "forwarding_policy": {
      "request_id_header": "X-Synapse-Request-Id"
    }
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
- Provider 钱包地址、结算账户、分账规则这类字段，应该保留在平台内部 Provider Profile / Settlement Profile 中，由 Gateway 在扣费和结算时使用。
- 对 Owner 侧 Agent 来说，真正重要的是 `service_id`、`description_for_model`、`input_schema`、`output_schema`、`price_model`、`endpoint_url` 和运行约束。
- 对平台 Gateway 来说，`gateway_extensions` 则补充了探活、转发、多 target 路由和计费策略这些内部执行信息。

## 4. Manifest 校验规则

Gateway 在 Provider 提交 Manifest 时，必须校验：

1. `service_id` 全局唯一
2. `description_for_model` 不得为空
3. `input_schema` / `output_schema` 必须是合法 JSON Schema
4. `price_model` 必须命中白名单
5. `endpoint_url` 必须可健康检查
6. `timeout_ms`、`max_payload_bytes` 必须在平台限制内
7. 若声明 `gateway_extensions.routing_targets`，则每个 target 都必须通过 URL 白名单与健康检查约束
8. 若声明 `gateway_extensions.metering_policy`，则计费规则必须和平台的结算模型兼容

补充原则：

- Provider 的链上身份和收款信息在平台内部完成绑定，不进入面向 Agent 的公开契约。
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

其余字段可以逐步丰富，但这几个缺一不可。

### 5.1 Provider Console V1 注册页收敛说明

第一版 Provider 注册页不会把所有 Manifest 字段都开放成可编辑表单。

以下字段在 V1 中由平台统一决定或通过运行时观测生成，不要求 Provider 在注册页面手工填写：

- `status`
- `runtime.streaming_supported`
- `runtime.async_supported`
- `runtime.callback_supported`
- `quality.*`
- `billing.unit_name`
- `billing.min_billable_unit`
- `billing.quote_required`
- `gateway_extensions.forwarding_policy.request_id_header`
- `gateway_extensions.forwarding_policy.pass_through_headers`
- `gateway_extensions.metering_policy.bill_on_error`
- `gateway_extensions.metering_policy.request_id_required`
- `gateway_extensions.metering_policy.response_size_metering`
- `gateway_extensions.metering_policy.billable_status_classes`

平台默认策略：

- 新建 service 默认进入 `draft`
- 服务是否可实际对外承载流量，由平台健康检查与运行状态决定
- `price_model` 在 V1 固定为 `fixed`，即按次调用计费
- `request_id_header` 固定为 `X-Synapse-Request-Id`
- `health_check.method` 固定为 `GET`
- `health_check.interval_sec` 固定为 `10`
- `health_check.success_codes` 固定为 `200`
- `quality` 由平台健康检查与运行观测生成，不由 Provider 手填
- `billable_status_classes` 表示“哪些 HTTP 响应类别可计费”，例如 `2` 代表 `2xx` 响应；V1 由平台统一控制
- `supported_languages` 在 V1 注册页只提供 `EN` / `CN` 下拉选择
- `unit_name` 与 `min_billable_unit` 不在 V1 注册页暴露，避免过早引入复杂计费语义
- `quote_required` 不在 V1 注册页暴露，因为 V1 不支持 quote-first 调用
- `pass_through_headers` 不在 V1 注册页暴露，由平台决定允许转发哪些头

`price_model` 枚举语义：

- `fixed`：固定单价，每次调用按一个稳定基础价格结算
- `tiered`：阶梯价格，预留给未来按用量或区间分层计费
- `quote`：先询价再调用，运行时必须先走 Quote 再决定是否 Invoke

因此，V1 注册页重点只收敛：身份、模型描述、输入输出 Schema、固定按次价格、运行边界、健康检查路径/超时、路由目标。

### 5.2 AI API Parser 输入约定

Provider Console 的 AI API Parser 在 V1 推荐直接粘贴“完整调用样例”，而不是只贴 cURL。

推荐格式：

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
{"input_text":"关于坚持","quotes":["穷则独善其身，达则兼济天下。—— 孟子","路漫漫其修远兮，吾将上下而求索。—— 屈原","不积跬步，无以至千里。—— 荀子"]}
```

Parser 需要从这段样例中推断：

- `runtime.endpoint_url`
- `io_schema.input_schema`
- `io_schema.output_schema`
- `model_usage.examples`
- `model_usage.description_for_model`
- `model_usage.supported_languages`
- `gateway_extensions.routing_targets`

也就是说，V1 parser 的目标不是返回旧版自由格式字段，而是直接返回当前注册页可以消费的标准 Manifest 结构。

## 6. 设计结论

Manifest 不是 Provider 自由发挥的介绍页，而是平台的结构化合同。

谁想让 Agent 自动调用，谁就必须把能力、价格、输入输出、运行约束说清楚。

同时要记住：**Manifest 是 Service Contract，不是 Provider Profile。**