# DefiLlama / DexScreener Source Capability Matrix

## 1. 目标

这份文档不讨论接口契约，而是把 `Protocol Fundamental Brief` 的 V1 上游 source 拆成可执行的 source matrix。

目标：

1. 明确 `DefiLlama` 和 `DexScreener` 各自负责什么 capability
2. 明确每个 source 该用哪些 endpoint、哪些字段、哪些字段不能过度承诺
3. 提前写死降级边界、pair 选择策略和测试要点，减少实现阶段返工

## 2. 设计原则

V1 一律遵守以下原则：

1. 一个 source 只对自己真正稳定覆盖的 capability 负责
2. 不把“能凑出来”的字段误写成“稳定长期契约”
3. 如果字段来自不同 endpoint，必须在内部 observation 层做归一化，不把上游碎片直接暴露到 service 层
4. 优先选免费、公开、结构清晰的 endpoint；不要把页面抓取伪装成 API source

## 3. V1 Capability 总表

| 内部 capability | 主 source | 备选 / 补充 source | V1 结论 |
| --- | --- | --- | --- |
| `protocol_identity` | `DefiLlama` | `DexScreener` 仅作 token/chain 辅助校验 | 以 `DefiLlama` 为主 |
| `price_context` | `DexScreener` | `DefiLlama coins` 可做极弱补充，不建议主用 | 以 `DexScreener` 为主 |
| `tvl_context` | `DefiLlama` | 无 | 以 `DefiLlama` 为绝对主源 |
| `revenue_activity_context` | `DefiLlama` | `DexScreener` 只补 usage / liquidity / trading activity proxy | 以 `DefiLlama` 为主，`DexScreener` 为补充 |
| `risk_context` | `DefiLlama + DexScreener` 组合 | 无 | 聚合生成，不由单源独占 |

一句话结论：

1. `DefiLlama` 负责协议级基本面骨架
2. `DexScreener` 负责 token 价格、链上交易热度和流动性补充
3. `risk_context` 由 aggregator 基于两边 observation 合成，不应假装任何单一 source 能独立完成

## 4. DefiLlama Capability Matrix

### 4.1 适配角色

建议 source name：`defillama_protocol`

V1 负责：

1. `protocol_identity`
2. `tvl_context`
3. 主体 `revenue_activity_context`
4. 部分 `risk_context`

不负责：

1. token 价格即时位置
2. DEX pair 级流动性与成交热度
3. 短周期市场微结构

### 4.2 建议优先 endpoint

V1 推荐按下面顺序接：

1. `GET /protocols`
   - 用于协议发现、slug 归一化、基础 current TVL 与近端变化
2. `GET /protocol/{protocol}`
   - 用于 historical TVL、chain breakdown、长期趋势判断
3. `GET /summary/fees/{protocol}`
   - 用于 fees / revenue / daily data 摘要

可选增强：

1. `GET /api/inflows/{protocol}/{timestamp}`
   - 用于后续增强资本流入流出解释
2. `GET /tvl/{protocol}`
   - 只适合轻量 current TVL 兜底，不适合单独支撑趋势分析

### 4.3 关键字段映射

#### `protocol_identity`

来源字段：

1. `name`
2. `symbol`
3. `chains`
4. `category`
5. `id` / protocol slug

落地信号：

1. `protocol_slug`
2. `display_name`
3. `token_symbols`
4. `supported_chains`
5. `protocol_category`

#### `tvl_context`

来源字段：

1. `tvl`
2. `change_1d`
3. `change_7d`
4. `chainTvls`
5. `currentChainTvls`
6. `chainTvls[*].tvl[].date`
7. `chainTvls[*].tvl[].totalLiquidityUSD`

落地信号：

1. `tvl_usd_current`
2. `tvl_change_1d_pct`
3. `tvl_change_7d_pct`
4. `tvl_change_30d_pct`
5. `chain_tvl_breakdown`
6. `chain_concentration_ratio`

#### `revenue_activity_context`

来源字段：

1. `summary/fees/{protocol}` 返回的 fees / revenue / volume / holders 等摘要字段
2. 若 free endpoint 不稳定，则退化到 TVL trend + category context

落地信号：

1. `fees_24h_usd`
2. `fees_7d_usd`
3. `fees_30d_usd`
4. `revenue_24h_usd`
5. `revenue_7d_usd`
6. `revenue_30d_usd`
7. `activity_signal_quality`

### 4.4 DefiLlama 适合写进摘要的内容

适合：

1. TVL 是扩张、持平还是收缩
2. 协议是否多链分散，还是过度集中在单链
3. 收入 / 费用是否稳定，是否出现明显塌缩或改善
4. 协议所属赛道，例如 lending、DEX、LST、perps

不适合直接写死的内容：

1. token 价格最近 24h / 72h 动量
2. 某条具体交易对的链上流动性质量
3. “收入一定准确完整” 这类强断言

### 4.5 DefiLlama 风险与降级

主要风险：

1. protocol slug 识别歧义
2. fees / revenue 数据对不同协议覆盖不一致
3. 部分 endpoint 免费版限频或字段稳定性弱于 TVL 主接口

降级原则：

1. 若 `protocols` / `protocol/{slug}` 可用，但 `summary/fees/{protocol}` 不可用
   - 仍可输出 `tvl_summary`
   - `revenue_signals` 降级为 usage/activity proxy
2. 若 protocol identity 无法唯一识别
   - 直接返回可解释错误，不进入 DexScreener 模糊推断

## 5. DexScreener Capability Matrix

### 5.1 适配角色

建议 source name：`dexscreener_market`

V1 负责：

1. `price_context`
2. 部分 `revenue_activity_context`
3. 部分 `risk_context`

不负责：

1. 协议级 TVL 主判断
2. 协议级收入真实性主判断
3. 协议 identity 主归一化

### 5.2 建议优先 endpoint

V1 推荐按下面顺序接：

1. `GET /latest/dex/search?q=`
   - 用于按 token / pair / symbol 搜索候选 pair
2. `GET /token-pairs/v1/{chainId}/{tokenAddress}`
   - 用于获取指定 token 在某链上的多池数据
3. `GET /tokens/v1/{chainId}/{tokenAddresses}`
   - 用于批量拉取 token pair 数据

V1 不建议优先使用：

1. `boosts`、`ads`、`community takeovers` 系列 endpoint
   - 这些更像营销或曝光信号，不适合进当前 protocol fundamental brief 主链

### 5.3 关键字段映射

#### `price_context`

来源字段：

1. `priceUsd`
2. `priceChange.*`
3. `fdv`
4. `marketCap`
5. `pairCreatedAt`

落地信号：

1. `spot_price_usd`
2. `price_change_5m_pct`
3. `price_change_1h_pct`
4. `price_change_6h_pct`
5. `price_change_24h_pct`
6. `market_cap_usd`
7. `fdv_usd`
8. `pair_age_days`

#### `revenue_activity_context`

来源字段：

1. `volume.*`
2. `txns.*.buys`
3. `txns.*.sells`
4. `liquidity.usd`

落地信号：

1. `volume_24h_usd`
2. `buy_txn_24h`
3. `sell_txn_24h`
4. `txn_imbalance`
5. `liquidity_usd`
6. `turnover_vs_liquidity`

#### `risk_context`

来源字段：

1. `liquidity.usd`
2. `boosts.active`
3. `pairCreatedAt`
4. `dexId`
5. `labels`

落地信号：

1. `liquidity_risk_level`
2. `pair_maturity_level`
3. `market_structure_notes`

### 5.4 DexScreener 适合写进摘要的内容

适合：

1. token price 在最近窗口是强、弱还是走平
2. 交易活跃度是否放大
3. 流动性是否足够支撑当前成交
4. pair 是否过新、过浅、过度依赖单池

不适合直接写死的内容：

1. 协议收入、净收入、经营质量的强判断
2. 协议级 TVL 趋势结论
3. 治理风险、参数风险等协议治理语义

### 5.5 Pair 选择策略

DexScreener 最大坑不是“没有数据”，而是一个 token 经常有多个 pair。

V1 必须写死 pair 选择规则：

1. 优先与协议主 token 匹配的 canonical chain
2. 在同链内优先 `liquidity.usd` 最大的 pair
3. 若 liquidity 接近，则优先 `volume.24h` 更高的 pair
4. 若仍冲突，则优先 quote token 为主流稳定币或主流 base asset 的 pair
5. 选中的 pair 要落入 raw feed / observation，便于调试

禁止：

1. 随机取搜索结果第一条
2. 把 meme pair、超低流动性 pair 混进 protocol brief 主链

## 6. 跨 Source 聚合规则

### 6.1 Capability 归属

| 输出字段 | 主判断 source | 辅助 source | 聚合原则 |
| --- | --- | --- | --- |
| `price_summary` | `DexScreener` | `DefiLlama` category/context | 按选中 pair 的价格与成交活跃度生成 |
| `tvl_summary` | `DefiLlama` | 无 | 只信任 DefiLlama protocol-level 数据 |
| `revenue_signals` | `DefiLlama` | `DexScreener` trading activity proxy | fees/revenue 缺失时允许降级 |
| `peer_comparison` | `DefiLlama` 为主 | `DexScreener` 可补价格相对强弱 | peer_set 优先做 TVL 与收入对比 |
| `risk_flags` | 聚合生成 | 两边都参与 | 不允许由单一 source 独断全部风险 |

### 6.2 freshness 预算

建议 V1 freshness 预算：

1. `DefiLlama`：`300s` 到 `900s`
2. `DexScreener`：`60s` 到 `180s`

理由：

1. `DefiLlama` 更偏 protocol-level / slower-moving data
2. `DexScreener` 更偏 market microstructure，需要更短 freshness

### 6.3 失败影响矩阵

| 失败 source | 仍可返回的核心内容 | 必须降级的内容 |
| --- | --- | --- |
| `DefiLlama` 失败 | `price_summary`、部分 market activity signal | `tvl_summary`、主体 `peer_comparison`、主体 `revenue_signals` |
| `DexScreener` 失败 | `tvl_summary`、部分 `revenue_signals`、protocol identity | `price_summary`、liquidity-driven risk flag |
| 双源失败 | 仅 snapshot fallback | 所有 live brief 判断 |

## 7. 建议 observation 结构

### 7.1 DefiLlama Observation

```json
{
  "source": "defillama_protocol",
  "capabilities": ["protocol_identity", "tvl_context", "revenue_activity_context"],
  "signals": {
    "protocol_slug": "aave",
    "display_name": "Aave",
    "category": "Lending",
    "supported_chains": ["Ethereum", "Arbitrum", "Polygon"],
    "tvl_usd_current": 5200000000,
    "tvl_change_1d_pct": 2.1,
    "tvl_change_7d_pct": -5.3,
    "tvl_change_30d_pct": 4.8,
    "fees_30d_usd": 14800000,
    "revenue_30d_usd": 6200000,
    "chain_concentration_ratio": 0.61
  }
}
```

### 7.2 DexScreener Observation

```json
{
  "source": "dexscreener_market",
  "capabilities": ["price_context", "revenue_activity_context", "risk_context"],
  "signals": {
    "chain_id": "ethereum",
    "pair_address": "0x...",
    "dex_id": "uniswap",
    "base_token_symbol": "AAVE",
    "quote_token_symbol": "USDC",
    "spot_price_usd": 96.2,
    "price_change_1h_pct": 0.8,
    "price_change_24h_pct": 3.4,
    "volume_24h_usd": 12800000,
    "buy_txn_24h": 1812,
    "sell_txn_24h": 1654,
    "liquidity_usd": 5400000,
    "fdv_usd": 1520000000,
    "market_cap_usd": 1450000000,
    "pair_age_days": 620
  }
}
```

## 8. 测试导向的落地要求

实现前就应该明确下面这些测试：

1. `DefiLlama` alias / slug 归一化测试
2. `DefiLlama` TVL trend 计算测试
3. `DefiLlama` fees / revenue 缺失时的降级测试
4. `DexScreener` 多 pair 选择测试
5. `DexScreener` 低流动性 pair 过滤测试
6. 双 source observation -> brief aggregation 测试
7. 单源失败 fallback 测试

## 9. V1 决策

V1 最终 source 决策建议：

1. `DefiLlama` 作为协议识别、TVL、主体收入信号的主骨架
2. `DexScreener` 作为价格、成交热度、流动性风险的主骨架
3. 不引入第三个 source，先把 pair 选择、降级路径、snapshot fallback 做扎实
4. 后续如果 `revenue_signals` 质量不够，再加授权 source，而不是在 V1 继续横向扩源