# 协议基本面情报包 API 设计与当前实现状态

## 1. 服务定位

- `service_id`: `svc_protocol_fundamental_brief`
- `service_name`: `Protocol Fundamental Brief`
- `service_slug`: `protocol-fundamental-brief`
- 目标：输出协议价格、TVL、收入信号、同类对比与风险标记的结构化 brief

## 2. 当前实现状态

当前状态不是“没做完”，而是“V1 主链已经可用，少数增强项仍保留为后续演进空间”。

已经落地的部分：

1. Provider endpoint 已存在：`POST /provider-services/protocol-fundamental-brief/invoke`
2. 该接口要求 Gateway 签名头校验，不接受裸请求直连
3. 请求与响应 schema 已落地，支持 `protocol`、`chain`、`peer_set`、`lookback_days`
4. `DefiLlama + DexScreener` 的 source adapter 与 capability-based plugin registry 已落地
5. 常见协议 alias 归一化已落地，例如 `aave protocol`、`uni`、`Lido Finance`
6. `DefiLlama` 协议识别现在会优先走 canonical slug 解析，`Aave -> aave-v3`、`Compound -> compound-v3`、`Morpho -> morpho-v1`、`Maker / Sky -> sky-lending` 这类主协议映射已收口，避免同 symbol 多候选时直接退化成歧义错误
7. `price_summary`、`tvl_summary`、`revenue_signals`、`peer_comparison`、`risk_flags`、`operator_view` 已切换为规则驱动模板聚合
8. `peer_set` 当前会优先基于 DefiLlama protocol-level observation 生成 TVL / revenue 相对比较
9. 已接入进程内 in-memory cache、typed snapshot repository、snapshot fallback 与 raw feed record 留存
10. source 全挂时会回退到最近一次持久化 snapshot，并在 `errors` 中追加 `PROTOCOL_BRIEF_SNAPSHOT_FALLBACK_USED`

当前没有做满的部分：

1. `peer_set` 还没有补 DexScreener 级别的相对价格强弱比较
2. Manifest 仍保持 `draft`，因为产品化定价、运营指标和控制面还没最终冻结
3. 当前聚焦 `DefiLlama + DexScreener` 双源，不继续横向扩第三个 source

一句话结论：如果问“V1 这个功能现在能不能用”，答案是可以；如果问“设计文档里所有增强项是不是都做满了”，答案是否。

## 3. Manifest 草案

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

## 4. 当前接口骨架

### 4.1 输入参数

| 参数 | 类型 | 必填 | 默认值 | 当前约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `protocol` | `string` | 是 | 无 | `1-100` 字符，不能为空 | 协议名、slug 或常见 alias |
| `chain` | `string` | 否 | `null` | 自动 lower-case | 多链协议的可选链范围 |
| `peer_set` | `string[]` | 否 | `[]` | 最多 `5` 个，自动去重 | 同类协议集合 |
| `lookback_days` | `integer` | 否 | `30` | `1-90` | 观察窗口，单位天 |

参数语义补充：

1. `protocol` 为空会直接返回 `422`
2. `lookback_days` 超出 `1-90` 会直接返回 `422`
3. `peer_set` 空字符串项会直接返回 `422`
4. 该接口要求 Gateway 签名头；缺少签名头返回 `401 / GATEWAY_SIGNATURE_REQUIRED`
5. 签名不匹配返回 `401 / GATEWAY_SIGNATURE_INVALID`
6. 如果 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`，本地可跳过验签直接调试

### 4.2 输出参数

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

## 5. 本地调试 curl

这个接口默认必须带三项签名头：

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
curl -X POST "http://127.0.0.1:8100/provider-services/protocol-fundamental-brief/invoke" \
  -H "Content-Type: application/json" \
  -d '{"protocol":"Aave","chain":"ethereum","peer_set":["Compound","Morpho"],"lookback_days":30}'
```

本地调试带签名示例：

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service

export GATEWAY_PROVIDER_SIGNATURE_SECRET="replace-this-with-a-provider-signature-secret"
export SIGNED_AT="1710931200"
export BODY='{"protocol":"Aave","chain":"ethereum","peer_set":["Compound","Morpho"],"lookback_days":30}'
export SIGNATURE=$(python - <<'PY'
import hashlib
import hmac
import json
import os

service_id = "svc_protocol_fundamental_brief"
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

curl -X POST "http://127.0.0.1:8100/provider-services/protocol-fundamental-brief/invoke" \
  -H "Content-Type: application/json" \
  -H "X-Synapse-Service-Id: svc_protocol_fundamental_brief" \
  -H "X-Synapse-Signed-At: ${SIGNED_AT}" \
  -H "X-Synapse-Signature: ${SIGNATURE}" \
  -d "${BODY}"
```

最小请求体示例：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/protocol-fundamental-brief/invoke" \
  -H "Content-Type: application/json" \
  -H "X-Synapse-Service-Id: svc_protocol_fundamental_brief" \
  -H "X-Synapse-Signed-At: ${SIGNED_AT}" \
  -H "X-Synapse-Signature: ${SIGNATURE}" \
  -d '{"protocol":"Aave"}'
```

## 6. Demo Response

```json
{
  "service": {
    "serviceId": "svc_protocol_fundamental_brief",
    "serviceName": "Protocol Fundamental Brief",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "defillama_protocol", "freshnessSec": 180 },
    { "name": "dexscreener_market", "freshnessSec": 30 }
  ],
  "freshness": {
    "generatedAt": "2026-03-25T12:25:00Z",
    "maxSourceAgeSec": 180,
    "cacheHit": false
  },
  "result": {
    "protocol": "Aave",
    "price_summary": "Aave price context is positive on ethereum via uniswap: spot $96.20, 24h change +4.3%, liquidity $5.40M (adequate depth) and 24h volume $12.80M (2.37x turnover vs liquidity).",
    "tvl_summary": "Aave TVL is slightly expanding at $5.20B; requested chain ethereum contributes about 62% of tracked TVL; 7d +2.2% and 30d +6.3%.",
    "revenue_signals": [
      "DefiLlama fee coverage remains live for Aave: fees $3.30M and revenue $1.80M in the latest available window.",
      "Market activity proxy is active on DexScreener with $12.80M 24h volume, 3466 24h transactions and 2.37x turnover vs liquidity."
    ],
    "peer_comparison": [
      "30d TVL trend is stronger than the selected peer median (+6.3% vs +1.8%).",
      "Current protocol scale sits above the selected peer median on TVL ($5.20B vs $1.85B)."
    ],
    "risk_flags": [
      "No acute liquidity or source-integrity risk flags were triggered for Aave in the latest observation window."
    ],
    "operator_view": "Useful as a fast screening brief for Aave; live protocol and market signals are broadly constructive before deeper due diligence."
  },
  "errors": []
}
```

## 7. Provider 侧实现逻辑

1. 校验协议名称与观察窗口
2. 查询本地协议快照缓存
3. 若缓存失效，则拉取价格、TVL、收入或活跃度等公开数据
4. 生成 `price_summary`、`tvl_summary`、`revenue_signals`
5. 如传入 `peer_set`，补充 `peer_comparison`
6. 结合数据波动和链上或治理特征生成 `risk_flags`
7. 输出 `operator_view` 作为快速研判结论
8. 写入协议快照表
9. 写入 source raw feed 摘要并返回结果

## 8. 当前边界

1. `peer_comparison` 当前仍以 DefiLlama protocol-level 对比为主，尚未补 DexScreener peer price relative strength
2. V1 只使用 `DefiLlama + DexScreener` 两个 source，不继续扩第三源
3. 服务目标是结构化 brief，不是长篇投研报告生成器
4. 缓存策略当前采用 `in-memory hot cache + persisted snapshot fallback`

## 9. 数据落地建议

- 必需表：`provider_api_invocations`
- 可选快照表：`provider_protocol_briefs`