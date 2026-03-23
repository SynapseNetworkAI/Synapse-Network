# 链上巨鲸资金异动监控 API 设计

## 1. 服务定位

- `service_id`: `svc_whale_flow_monitor`
- `service_name`: `Whale Flow Monitor`
- `service_slug`: `whale-flow-monitor`
- 目标：监控大额链上转账并输出结构化巨鲸事件、地址标签、净流向和潜在市场影响

## 2. Manifest 草案

```json
{
  "service_id": "svc_whale_flow_monitor",
  "service_name": "Whale Flow Monitor",
  "service_slug": "whale-flow-monitor",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Monitor large on-chain token movements and return structured whale events, wallet tags, net direction, and estimated market impact.",
  "task_category": "web3.onchain.flow-monitoring",
  "capabilities": [
    "large_transfer_detection",
    "wallet_tagging",
    "net_direction_summary",
    "market_impact_guess"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.10",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/whale-flow-monitor/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 12000,
  "streaming_supported": false,
  "async_supported": false,
  "callback_supported": false,
  "max_payload_bytes": 262144,
  "availability_slo": 0.99,
  "region": ["global"],
  "compliance_tags": ["onchain-data", "monitoring", "no-pii"]
}
```

## 3. Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["token", "chain"],
  "properties": {
    "token": {
      "type": "string",
      "description": "Token symbol or contract address."
    },
    "chain": {
      "type": "string",
      "description": "Chain scope, such as ethereum, base, arbitrum."
    },
    "window_minutes": {
      "type": "integer",
      "minimum": 5,
      "maximum": 1440,
      "default": 60
    },
    "min_usd_value": {
      "type": "number",
      "minimum": 10000,
      "default": 100000
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50,
      "default": 10
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
      "required": ["token", "chain", "net_direction", "market_impact_guess", "events"],
      "properties": {
        "token": { "type": "string" },
        "chain": { "type": "string" },
        "net_direction": { "type": "string", "enum": ["net_inflow", "net_outflow", "mixed"] },
        "market_impact_guess": { "type": "string" },
        "watchlist_matches": {
          "type": "array",
          "items": { "type": "string" }
        },
        "events": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["timestamp", "usd_value", "direction", "summary"],
            "properties": {
              "timestamp": { "type": "string" },
              "usd_value": { "type": "number" },
              "direction": { "type": "string" },
              "wallet_tags": {
                "type": "array",
                "items": { "type": "string" }
              },
              "summary": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

## 5. Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_whale_flow_monitor",
    "serviceName": "Whale Flow Monitor",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "blockscout", "freshnessSec": 20 },
    { "name": "dexscreener", "freshnessSec": 15 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:20:00Z",
    "maxSourceAgeSec": 20,
    "cacheHit": false
  },
  "result": {
    "token": "ETH",
    "chain": "ethereum",
    "net_direction": "net_outflow",
    "market_impact_guess": "Whale transfers suggest potential exchange-side sell pressure in the current window.",
    "watchlist_matches": ["known_exchange", "smart_money_watchlist"],
    "events": [
      {
        "timestamp": "2026-03-23T12:12:14Z",
        "usd_value": 2450000,
        "direction": "wallet_to_exchange",
        "wallet_tags": ["whale_wallet", "known_exchange"],
        "summary": "A whale-sized ETH transfer moved into a tagged exchange wallet."
      },
      {
        "timestamp": "2026-03-23T11:58:02Z",
        "usd_value": 1380000,
        "direction": "wallet_to_wallet",
        "wallet_tags": ["smart_money_watchlist"],
        "summary": "A tracked smart-money wallet reallocated ETH across self-custody addresses."
      }
    ]
  },
  "errors": []
}
```

## 6. Provider 侧实现逻辑

1. 校验 `token`、`chain`、时间窗、最小金额阈值
2. 读取最近窗口内的本地事件缓存
3. 若缓存不足，则拉取链上转账数据和价格换算数据
4. 按 `min_usd_value` 过滤大额事件
5. 对地址做轻量标签归类，例如 `exchange`、`whale_wallet`、`smart_money_watchlist`
6. 汇总 `net_direction` 与 `market_impact_guess`
7. 生成 `events` 列表与 `watchlist_matches`
8. 写入事件快照表
9. 写入接口调用日志并返回结果

## 7. 最小实现建议

1. V1 先支持 EVM 主链
2. 标签系统先走静态标签 + 简单规则
3. 不做实时流处理，先按调用窗口查询聚合

## 8. 数据落地建议

- 必需表：`provider_api_invocations`
- 可选快照表：`provider_whale_flow_snapshots`