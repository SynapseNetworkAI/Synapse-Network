# 协议基本面情报包 API 设计

## 1. 服务定位

- `service_id`: `svc_protocol_fundamental_brief`
- `service_name`: `Protocol Fundamental Brief`
- `service_slug`: `protocol-fundamental-brief`
- 目标：输出协议价格、TVL、收入信号、同类对比与风险标记的结构化 brief

## 2. Manifest 草案

```json
{
  "service_id": "svc_protocol_fundamental_brief",
  "service_name": "Protocol Fundamental Brief",
  "service_slug": "protocol-fundamental-brief",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Return a structured protocol intelligence brief covering price context, TVL trend, revenue signals, peer comparison, and key risk flags.",
  "task_category": "web3.research.fundamental-brief",
  "capabilities": [
    "protocol_snapshot",
    "tvl_summary",
    "revenue_signal_summary",
    "peer_comparison",
    "risk_flagging"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.03",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/protocol-fundamental-brief/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 10000,
  "streaming_supported": false,
  "async_supported": false,
  "callback_supported": false,
  "max_payload_bytes": 131072,
  "availability_slo": 0.99,
  "region": ["global"],
  "compliance_tags": ["research", "market-data", "no-pii"]
}
```

## 3. Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["protocol"],
  "properties": {
    "protocol": {
      "type": "string",
      "description": "Protocol name, slug, or token ticker for lookup."
    },
    "chain": {
      "type": "string",
      "description": "Optional chain filter for multi-chain protocols."
    },
    "peer_set": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 5
    },
    "lookback_days": {
      "type": "integer",
      "minimum": 1,
      "maximum": 90,
      "default": 30
    }
  }
}
```

## 4. Output Schema 草案

```json
{
  "type": "object",
  "required": ["service", "freshness", "result", "errors"],
  "properties": {
    "service": { "type": "object" },
    "sources": { "type": "array" },
    "freshness": { "type": "object" },
    "errors": { "type": "array" },
    "result": {
      "type": "object",
      "required": ["protocol", "price_summary", "tvl_summary", "revenue_signals", "peer_comparison", "risk_flags"],
      "properties": {
        "protocol": { "type": "string" },
        "price_summary": { "type": "string" },
        "tvl_summary": { "type": "string" },
        "revenue_signals": {
          "type": "array",
          "items": { "type": "string" }
        },
        "peer_comparison": {
          "type": "array",
          "items": { "type": "string" }
        },
        "risk_flags": {
          "type": "array",
          "items": { "type": "string" }
        },
        "operator_view": { "type": "string" }
      }
    }
  }
}
```

## 5. Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_protocol_fundamental_brief",
    "serviceName": "Protocol Fundamental Brief",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "dexscreener", "freshnessSec": 60 },
    { "name": "defillama", "freshnessSec": 90 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:25:00Z",
    "maxSourceAgeSec": 90,
    "cacheHit": true
  },
  "result": {
    "protocol": "Aave",
    "price_summary": "Token price remains above the 30-day midpoint, but upside has slowed over the last 72 hours.",
    "tvl_summary": "TVL is stable to slightly positive over the 30-day window with no major cross-chain contraction.",
    "revenue_signals": [
      "Usage-linked fee activity remains consistent.",
      "There is no obvious revenue collapse signal in the latest window."
    ],
    "peer_comparison": [
      "TVL trend is stronger than the median of selected lending peers.",
      "Revenue momentum appears steadier than smaller emerging competitors."
    ],
    "risk_flags": [
      "Governance-driven parameter changes can rapidly alter collateral behavior.",
      "Macro liquidity shifts may compress lending demand."
    ],
    "operator_view": "Useful as a fast screening brief before deeper protocol due diligence."
  },
  "errors": []
}
```

## 6. Provider 侧实现逻辑

1. 校验协议名称与观察窗口
2. 查询本地协议快照缓存
3. 若缓存失效，则拉取价格、TVL、收入或活跃度等公开数据
4. 生成 `price_summary`、`tvl_summary`、`revenue_signals`
5. 如传入 `peer_set`，补充 `peer_comparison`
6. 结合数据波动和链上或治理特征生成 `risk_flags`
7. 输出 `operator_view` 作为快速研判结论
8. 写入协议快照表
9. 写入接口调用日志并返回结果

## 7. 最小实现建议

1. V1 优先做 `DefiLlama + DexScreener` 级别公开数据整合
2. 先不做长篇报告，只做结构化 brief
3. 每次调用返回 5 到 10 条高价值摘要，不要写成研报生成器

## 8. 数据落地建议

- 必需表：`provider_api_invocations`
- 可选快照表：`provider_protocol_briefs`