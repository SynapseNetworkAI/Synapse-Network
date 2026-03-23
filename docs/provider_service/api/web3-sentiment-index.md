# Web3 实时情绪指数 API 设计

## 1. 服务定位

- `service_id`: `svc_web3_sentiment_index`
- `service_name`: `Web3 Sentiment Index`
- `service_slug`: `web3-sentiment-index`
- 目标：返回可供 Agent 消费的结构化市场情绪分、趋势方向、波动信号与简要解释

## 2. Manifest 草案

```json
{
  "service_id": "svc_web3_sentiment_index",
  "service_name": "Web3 Sentiment Index",
  "service_slug": "web3-sentiment-index",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Return a structured crypto market sentiment score with trend direction, volatility signal, and concise reasoning for a token or market segment.",
  "task_category": "web3.market.sentiment",
  "capabilities": [
    "market_sentiment_scoring",
    "trend_summary",
    "volatility_signal",
    "multi_source_reasoning"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.01",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/web3-sentiment-index/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 8000,
  "streaming_supported": false,
  "async_supported": false,
  "callback_supported": false,
  "max_payload_bytes": 131072,
  "availability_slo": 0.99,
  "region": ["global"],
  "compliance_tags": ["market-data", "public-data", "no-pii"]
}
```

## 3. Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["symbol"],
  "properties": {
    "symbol": {
      "type": "string",
      "description": "Token symbol or market symbol, such as BTC, ETH, SOL.",
      "minLength": 2,
      "maxLength": 20
    },
    "chain": {
      "type": "string",
      "description": "Optional chain scope, such as ethereum, solana, base.",
      "default": "market-wide"
    },
    "lookback_hours": {
      "type": "integer",
      "minimum": 1,
      "maximum": 168,
      "default": 24
    },
    "include_narrative": {
      "type": "boolean",
      "default": true
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
      "required": ["symbol", "sentiment_score", "sentiment_label", "trend_direction", "volatility_signal", "reasoning_bullets"],
      "properties": {
        "symbol": { "type": "string" },
        "sentiment_score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "sentiment_label": { "type": "string", "enum": ["extreme_fear", "fear", "neutral", "greed", "extreme_greed"] },
        "trend_direction": { "type": "string", "enum": ["up", "down", "sideways"] },
        "volatility_signal": { "type": "string", "enum": ["low", "medium", "high"] },
        "market_temperature": { "type": "string" },
        "reasoning_bullets": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 2,
          "maxItems": 5
        },
        "action_hint": { "type": "string" }
      }
    }
  }
}
```

## 5. Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_web3_sentiment_index",
    "serviceName": "Web3 Sentiment Index",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "alternative_me", "freshnessSec": 1800 },
    { "name": "coingecko", "freshnessSec": 45 },
    { "name": "binance_market_data", "freshnessSec": 8 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:00:00Z",
    "maxSourceAgeSec": 1800,
    "cacheHit": true
  },
  "result": {
    "symbol": "ETH",
    "sentiment_score": 68,
    "sentiment_label": "greed",
    "trend_direction": "up",
    "volatility_signal": "medium",
    "market_temperature": "risk-on but not overheated",
    "reasoning_bullets": [
      "Fear and Greed baseline is above neutral.",
      "Short-term price momentum remains positive.",
      "Intraday volatility is elevated but still below panic range."
    ],
    "action_hint": "Suitable for momentum-following agents, but keep tighter risk controls than in a low-volatility regime."
  },
  "errors": []
}
```

## 6. Provider 侧实现逻辑

1. 校验 `symbol`、`chain`、`lookback_hours`
2. 读取本地情绪快照缓存，判断是否在可复用时间窗内
3. 若缓存失效，则并行拉取免费市场数据源，例如情绪指数、价格动量、波动率、成交量变化
4. 将不同来源映射到统一分值区间
5. 计算 `sentiment_score`、`sentiment_label`、`trend_direction`、`volatility_signal`
6. 拼接 `reasoning_bullets` 和 `action_hint`
7. 写入情绪快照表
8. 写入接口调用日志
9. 返回标准响应

## 7. 最小实现建议

1. V1 不做复杂机器学习模型
2. 先做规则分数聚合器即可
3. 先支持 `BTC`、`ETH`、`SOL` 等高频 `symbol`

## 8. 数据落地建议

- 必需表：`provider_api_invocations`
- 可选快照表：`provider_sentiment_snapshots`