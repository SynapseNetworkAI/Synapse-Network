# Web3 实时情绪指数 API 设计与当前实现状态

## 1. 服务定位

- `service_id`: `svc_web3_sentiment_index`
- `service_name`: `Web3 Sentiment Index`
- `service_slug`: `web3-sentiment-index`
- 目标：返回可供 Agent 消费的结构化市场情绪分、趋势方向、波动信号与简要解释

## 2. 当前实现状态

当前状态不是“未实现”，而是“接口、真实多源抓取、轻量持久化、PostgreSQL repository 骨架都已实现，但还没到生产级调度与可观测性”。

已经落地的部分：

1. Provider endpoint 已存在：`POST /provider-services/web3-sentiment-index/invoke`
2. 该接口要求 Gateway 签名头校验，不接受裸请求直连
3. 请求与响应 schema 已落地
4. 支持的 `symbol` 当前只包含：`BTC`、`ETH`、`SOL`
5. 支持的 `chain` 当前只包含：`market-wide`、`ethereum`、`solana`、`base`
6. 返回结构已经稳定为：`service`、`sources`、`freshness`、`result`、`errors`
7. `Alternative.me` 的真实 adapter 已落地，并已接入主流程
8. `Binance public market data` 的真实 adapter 已落地，并已同时承担 token 级动量、成交热度与短周期波动计算
9. 当前 volatility 已从“24h 涨跌幅猜测”升级为基于 Binance `5m` kline close 序列的 realized volatility
10. 当外部源不可用时，服务会退回 provider 内部规则模型，不会直接把接口打死
11. repository 已升级为正式抽象，当前同时支持 file-backed 与 PostgreSQL 两种实现
12. 已有测试覆盖正常路径、签名校验、非法 symbol、非法字段、缓存命中、adapter 解析与 live-source fallback

还没有落地的部分：

1. 还没有调度型抓取任务、失败重试、限频治理和熔断控制
2. 还没有原始抓取结果留存、失败重试、限频调度和熔断降级
3. 还没有 source 级持久化可观测性和 replay 工具
4. 还没有独立 aggregator worker 与 source 管理控制面

## 3. 当前数据是怎么算出来的

当前返回的 `sentiment_score` 不是来自外部实时市场接口，而是来自本地规则计算：

1. 代码里内置了 `BTC`、`ETH`、`SOL` 的 `SymbolProfile`
2. 按 `chain` 加分或减分
3. 按 `lookback_hours` 做简单惩罚
4. 再映射出 `sentiment_label`、`trend_direction`、`volatility_signal`
5. `reasoning_bullets` 也由本地模板拼接生成

这意味着它现在更像一个“稳定 API 骨架 + 演示级规则引擎”，而不是生产级实时情绪引擎。

## 4. 现在数据存储到哪里

当前已经具备可切换的持久化层，不再只有进程内缓存。

现在真实落点有三处：

1. 进程内内存缓存 `_snapshot_cache`
  - key: `(symbol, chain, lookback_hours, include_narrative)`
  - value: `(created_at, SentimentResponse)`
  - TTL: `300` 秒
2. 本地 file-backed snapshot repository
  - 默认目录：`provider_service/logs/sentiment/snapshots/`
  - 作用：进程重启后仍可回退最近一次 snapshot
3. PostgreSQL repository
  - 通过 `SENTIMENT_REPOSITORY_BACKEND=postgres` + `PROVIDER_SERVICE_POSTGRES_DSN` 启用
  - 默认表：`provider_sentiment_snapshots`、`provider_sentiment_raw_feeds`
  - 作用：把 snapshot 与 source 摘要落到正式数据库，而不是只写本地文件
4. 本地 raw feed 摘要文件
  - 默认目录：`provider_service/logs/sentiment/raw_feeds/`
  - 作用：在 file-backed 模式下记录每次 source 抓取成功/失败的简要结果

当前仍未实现的存储：

1. `provider_api_invocations` 数据库表
2. source 全量 payload 的对象存储归档
3. Redis
4. 跨实例共享缓存

所以现在已经有“轻量持久化 + PostgreSQL 正式 repository 骨架”，但还不是生产级数据管道实现。

## 5. 现在数据来源是什么

当前真实数据来源分两层：

1. 第一层是真实外部市场接口：`Alternative.me`、`Binance public market data`
2. 第二层是 provider 本地 fallback 规则，用于外部源失败时保底

当前 fallback 规则主要来自：

1. `SYMBOL_PROFILES`
2. `CHAIN_SCORE_ADJUSTMENTS`

这里要特别说明：

`sources` 字段不再只是静态声明。对于 `Alternative.me` 和 `Binance public market data`，现在会按真实抓取结果返回 freshness；如果抓取失败，则写入 `errors` 并走 fallback。

现在已经真实接入的来源：

1. `alternative_me`
2. `binance_market_data`

## 6. 现阶段从哪里可以获取 Web3 实时情绪指数

如果问“现在线上哪里能拿到真正的 Web3 实时情绪数据”，答案不是本仓当前 provider runtime，而是以下公共或半公共来源：

1. `Alternative.me Fear & Greed Index`
   - 适合做全市场风险偏好基线
   - 优点：简单、稳定、认知强
   - 缺点：更偏市场整体，不够 token-specific
2. `Binance Public Market Data`
   - 适合拿 ticker、kline、成交量、短周期波动
  - 当前已承担 token 级动量、成交热度和短周期实时性

如果以后要做更强的“实时情绪指数”，还可以追加：

1. `DexScreener` 作为链上交易热度和池子深度补充
2. `DefiLlama` 作为协议资金面或链生态背景信号补充
3. 社交情绪源，例如 `LunarCrush` 一类来源，作为更高阶版本

## 7. 当前接口骨架

### 7.1 请求参数说明

| 参数 | 类型 | 必填 | 默认值 | 当前允许值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `symbol` | `string` | 是 | 无 | `BTC` `ETH` `SOL` | 目标币种。服务当前只支持这三个 symbol。 |
| `chain` | `string` | 否 | `market-wide` | `market-wide` `ethereum` `solana` `base` | 情绪分析的链或市场范围。 |
| `lookback_hours` | `integer` | 否 | `24` | `1` 到 `168` | 回看窗口，单位小时。窗口越长，结果越偏稳态。 |
| `include_narrative` | `boolean` | 否 | `true` | `true` `false` | 是否返回 narrative 解释文本。 |

参数语义补充：

1. `symbol` 非法会直接返回 `422`。
2. `chain` 非法会直接返回 `422`。
3. `lookback_hours` 超出 `1-168` 会直接返回 `422`。
4. 该接口要求 Gateway 签名头；缺少签名头返回 `401 / GATEWAY_SIGNATURE_REQUIRED`。
5. 签名不匹配返回 `401 / GATEWAY_SIGNATURE_INVALID`。
6. 如果 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`，本地可跳过验签直接调试。

### 7.2 本地调试 curl

这个接口不是裸调接口，必须带三项签名头：

1. `X-Synapse-Service-Id`
2. `X-Synapse-Signed-At`
3. `X-Synapse-Signature`

签名规则：

1. 先把请求 JSON 做 canonical 序列化：`sort_keys=True` + `separators=(",", ":")`
2. 对 canonical body 做 `sha256`
3. 拼接 canonical string：`{service_id}.{signed_at}.{body_sha256}`
4. 使用 `GATEWAY_PROVIDER_SIGNATURE_SECRET` 做 `HMAC-SHA256`

如果本地只是调试 provider 逻辑，也可以在 `provider_service/.env.local` 里设置：

```env
GATEWAY_PROVIDER_SIGNATURE_ENABLED=false
```

关闭后，可直接使用无签名 curl：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/web3-sentiment-index/invoke" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"ETH","chain":"ethereum","lookback_hours":24,"include_narrative":true}'
```

本地调试示例：

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service

export GATEWAY_PROVIDER_SIGNATURE_SECRET="replace-this-with-a-provider-signature-secret"
export SIGNED_AT="1710931200"
export BODY='{"symbol":"ETH","chain":"ethereum","lookback_hours":24,"include_narrative":true}'
export SIGNATURE=$(python - <<'PY'
import hashlib
import hmac
import json
import os

service_id = "svc_web3_sentiment_index"
signed_at = os.environ["SIGNED_AT"]
secret = os.environ["GATEWAY_PROVIDER_SIGNATURE_SECRET"].encode("utf-8")
payload = json.loads(os.environ["BODY"])
canonical_body = json.dumps(
    payload,
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
)
digest = hashlib.sha256(canonical_body.encode("utf-8")).hexdigest()
canonical = f"{service_id}.{signed_at}.{digest}"
print(hmac.new(secret, canonical.encode("utf-8"), hashlib.sha256).hexdigest())
PY
)

curl -X POST "http://127.0.0.1:8100/provider-services/web3-sentiment-index/invoke" \
  -H "Content-Type: application/json" \
  -H "X-Synapse-Service-Id: svc_web3_sentiment_index" \
  -H "X-Synapse-Signed-At: ${SIGNED_AT}" \
  -H "X-Synapse-Signature: ${SIGNATURE}" \
  -d "${BODY}"
```

最小请求体示例：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/web3-sentiment-index/invoke" \
  -H "Content-Type: application/json" \
  -H "X-Synapse-Service-Id: svc_web3_sentiment_index" \
  -H "X-Synapse-Signed-At: ${SIGNED_AT}" \
  -H "X-Synapse-Signature: ${SIGNATURE}" \
  -d '{"symbol":"BTC"}'
```

### 7.3 参数组合示例

1. 全市场 BTC 情绪：`{"symbol":"BTC"}`
2. Ethereum 范围 ETH 情绪：`{"symbol":"ETH","chain":"ethereum"}`
3. Solana 范围 SOL 情绪：`{"symbol":"SOL","chain":"solana","lookback_hours":12}`
4. 关闭 narrative：`{"symbol":"ETH","include_narrative":false}`

### Request

```json
{
  "symbol": "ETH",
  "chain": "ethereum",
  "lookback_hours": 24,
  "include_narrative": true
}
```

### Response

```json
{
  "service": {
    "serviceId": "svc_web3_sentiment_index",
    "serviceName": "Web3 Sentiment Index",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "alternative_me", "freshnessSec": 1800 },
    { "name": "binance_market_data", "freshnessSec": 8 }
  ],
  "freshness": {
    "generatedAt": "2026-03-24T12:00:00Z",
    "maxSourceAgeSec": 1800,
    "cacheHit": false
  },
  "result": {
    "symbol": "ETH",
    "sentiment_score": 68,
    "sentiment_label": "greed",
    "trend_direction": "up",
    "volatility_signal": "medium",
    "market_temperature": "risk-on but not overheated",
    "reasoning_bullets": [
      "ETH keeps a positive composite baseline over the last 24h window.",
      "Trend direction is up after weighting short-term momentum and chain-relative flow.",
      "Volatility is medium, which changes how aggressively agents should size entries.",
      "Chain scope 'ethereum' adds contextual bias instead of replacing market-wide sentiment."
    ],
    "action_hint": "Suitable for momentum-following agents, but keep tighter risk controls than in a low-volatility regime."
  },
  "errors": []
}
```

## 8. Manifest 草案

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

## 9. 后续实现边界

后续推进真实实现时，必须遵守以下边界：

1. Provider service 负责抓取、聚合、缓存和返回结果
2. Gateway 只负责调用、鉴权、计费与注册，不负责情绪计算细节
3. `provider_service` 可以做本地缓存和 provider-side observability，但不承担平台结算和控制面语义
4. 文档必须持续明确区分“当前真实实现”与“目标设计”

## 10. 下一步文档

1. 数据来源需求见 [web3-sentiment-data-source-requirements.md](./web3-sentiment-data-source-requirements.md)
2. 抓取与聚合设计见 [web3-sentiment-crawling-design.md](./web3-sentiment-crawling-design.md)