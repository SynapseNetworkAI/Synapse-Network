# Web3 实时情绪指数生产级抓取与聚合设计文档

## 1. 设计目标

本设计文档回答的不是“接口长什么样”，而是“后续怎么把真实数据抓回来并稳定算出情绪指数”。

目标：

1. 让 `Web3 Sentiment Index` 从本地规则 demo 升级为真实多源聚合服务
2. 维持 Provider runtime 的清晰分层，不把抓取逻辑塞进 router
3. 为后续数据库落地、回放、重试和告警预留结构

## 2. 生产目标

生产级 V1 不是“复杂到不可维护”，而是最少满足下面 6 个要求：

1. 请求路径可控，单源故障不拖垮整体请求
2. source 级 timeout、retry、backoff 可配置
3. snapshot 与 raw feed 有结构化持久化，不靠临时日志排障
4. raw feed 至少保留 source、耗时、重试次数、错误码、payload hash、摘要内容
5. 持久化层支持 Postgres，且和 gateway 主库隔离
6. 代码、测试、初始化 SQL、运行文档必须一起收敛

## 3. 当前问题

当前实现仍存在 4 个结构性缺口：

1. 两个 V1 运行时数据源都已有真实 adapter，但聚合规则仍然偏轻量
2. 情绪分仍然是“live source + fallback rule” 的轻量聚合，不是完整实时多源引擎
3. 虽然已经有 PostgreSQL repository 和初始化 SQL，但 snapshot store 仍只是轻量 runtime persistence，不是完整数据管道
4. raw feed 现在只保存摘要，不是完整可回放原始 payload

## 4. 目标架构

建议拆成 5 层：

1. `source adapters`
   - 每个上游一个 adapter，例如 `alternative_me.py`、`binance_market_data.py`
2. `fetch orchestrator`
   - 并发请求多个 source，统一收集结果、异常和耗时
3. `normalizers`
   - 把不同来源映射成内部统一信号对象
4. `sentiment aggregator`
   - 计算最终 `sentiment_score` 与解释字段
5. `snapshot repository`
   - 写入快照和原始抓取摘要

## 5. 目录建议

建议后续代码结构演进为：

```text
provider_service/app/
  services/
    sentiment_service.py
    sentiment/
      adapters/
        alternative_me.py
        binance_market_data.py
      models.py
      normalizers.py
      aggregator.py
      repository.py
      cache.py
```

## 6. 生产请求流程

每次 `POST /invoke` 的主流程建议如下：

1. 校验签名与请求 schema
2. 计算 cache key：`(symbol, chain, lookback_hours, include_narrative)`
3. 先查快照缓存
4. 如果缓存未命中或已过期，则并发抓取当前 2 个运行时来源
5. 将每个来源映射成统一信号对象
6. 聚合得到最终情绪快照
7. 先保存 snapshot，再保存 raw feed 记录，避免外键写入顺序错误
8. 回写缓存
9. 返回标准响应

当前实现状态：

1. 这个流程已经真实落地
2. 当前前台读路径已经支持 `fresh / stale-but-servable / expired` 三档 freshness policy
3. `fresh` 和 `stale-but-servable` 会优先返回已有 snapshot；只有 hard-expired 才同步补抓
3. snapshot 与 raw feed 已进入独立 provider 数据库 `synapse_gateway_providers`

## 7. 生产抓取策略

建议：

1. 统一使用异步 HTTP client
2. 单源超时要短，避免最慢源拖死整体
3. 抓取以“并发 + 局部容错”为主，而不是串行等待

生产级 V1 超时与重试策略：

1. `Alternative.me`: `2s`
2. `Binance`: `1s`
3. `max_attempts`: `2`
4. `backoff`: `200ms * attempt`
5. 如遇区域封锁、统一出口治理或公网抖动，抓取 worker 可开启代理池并对代理 URL 做轮转

当前实现状态：

1. 已支持 per-source timeout
2. 已支持统一 `max_attempts` + 线性 backoff
3. `Binance` 仍然是 source 内部双请求并发：`ticker/24hr` + `klines`
4. 已支持 `SENTIMENT_PROXY_POOL_ENABLED` + `SENTIMENT_PROXY_POOL_URLS_JSON` 控制抓取 worker 代理池出站；每次独立抓取尝试会轮转选择代理
5. `.env.*` 中的 `SENTIMENT_PROXY_POOL_URLS_JSON` 需要使用 shell-safe quoting，例如 `'["http://127.0.0.1:7890"]'`，否则启动脚本 `source` 后会把 JSON 字符串内部双引号剥掉
6. 代理模式会引入 `SENTIMENT_PROXY_TIMEOUT_FLOOR_S` 作为最小 timeout floor，并把 scheduler 刷新并发限制到代理池大小，减少单代理部署下的连接超时和重复刷新风暴

## 8. 统一中间结构

每个 source adapter 输出统一内部对象：

```json
{
   "source": "binance_market_data",
  "success": true,
  "fetched_at": "2026-03-24T12:00:00Z",
   "latency_ms": 83,
   "retry_count": 1,
    "timeout_ms": 1000,
   "http_status": 200,
  "staleness_sec": 12,
   "payload_hash": "sha256:...",
  "metrics": {
      "price": 3518.75,
    "change_24h_pct": 4.2,
      "volume_24h_usd": 29500000000
   }
}
```

然后统一交给 aggregator，而不是在 adapter 里直接拼最终 response。

当前实现状态：

1. adapter 已返回 source timestamp、latency、retry、timeout、http status、payload hash、payload excerpt
2. 这些字段已经落库到 `provider_sentiment_raw_feeds`

## 9. 聚合规则设计

V1 建议用规则聚合，不上机器学习。

评分可拆成 4 个子分：

1. `market_baseline_score`
   - 来自 Fear & Greed
2. `momentum_score`
   - 来自 `Binance 24h` 价格变化
3. `volume_heat_score`
   - 来自 `Binance` 的成交活跃度
4. `volatility_penalty`
   - 来自 `Binance` kline 波动率

当前状态：

1. `market_baseline_score` 已接 `Alternative.me`
2. `momentum_score` 已接 `Binance 24h` 变化
3. `volume_heat_score` 已开始使用 `Binance quoteVolume`
4. `volatility_penalty` 已接 `Binance 5m` kline close 序列的 realized volatility

最终公式建议：

`sentiment_score = baseline * 0.35 + momentum * 0.30 + volume_heat * 0.20 - volatility_penalty * 0.15`

注意：

1. 这是设计起点，不是最终真理
2. 所有权重必须写死在配置或常量中，不能藏在临时代码里

## 10. 缓存设计

建议两层缓存：

1. 进程内短缓存
   - 用于同一进程内高频重复请求
   - TTL: `60s` 到 `300s`
2. 持久化快照缓存
   - 用于进程重启后的 fallback
   - TTL: 可接受到 `15m`，但必须显式暴露 freshness

当前代码里两层缓存都已有可运行实现，但持久化层还需要继续增强 replay、审计和全量 payload 归档。

当前状态更新：

1. 第一层进程内缓存已存在
2. 第二层已经同时支持 file-backed snapshot / raw feed 和 PostgreSQL repository
3. `docker-compose/postgres/init/gateway-providers/` 现在已经纳入独立 provider 数据库 `synapse_gateway_providers` 的初始化链路

## 11. 存储设计

### 10.1 原始抓取表

建议表：`provider_sentiment_raw_feeds`

当前落地字段：

1. `id`
2. `snapshot_key`
3. `symbol`
4. `chain`
5. `source_name`
6. `fetched_at`
7. `source_timestamp`
8. `success`
9. `http_status`
10. `latency_ms`
11. `retry_count`
12. `timeout_ms`
13. `payload_hash`
14. `error_code`
15. `error_message`
16. `payload_json`

### 10.2 快照表

建议表：`provider_sentiment_snapshots`

当前落地字段：

1. `snapshot_key`
2. `symbol`
3. `chain`
4. `lookback_hours`
5. `include_narrative`
6. `source_count`
7. `max_source_age_sec`
8. `generated_at`
9. `sentiment_score`
10. `sentiment_label`
11. `trend_direction`
12. `volatility_signal`
13. `market_temperature`
14. `response_json`

## 12. 降级与容错

建议降级规则：

1. 3 源全部成功：正常返回
2. 缺 1 源：返回结果，但 `errors` 增加 warning 记录
3. 只剩 1 源：不再标记为“实时情绪指数”，返回降级告警
4. 全部失败：优先返回最近一次 snapshot；若没有 snapshot，则返回可解释错误

## 13. 安全与限频

因为该接口由 Gateway 调用，所以还要加两层保护：

1. 保持现有 Gateway 签名校验
2. 对外部 source adapter 加 provider 侧 timeout、retry、backoff 和后续 rate limit

否则上游免费接口很容易被打穿。

## 14. 生产级 V1 已实现内容

当前已经真实落地的生产级 V1 组件：

1. Gateway-signed request entry
2. request-time concurrent fetch orchestrator
3. per-source timeout config
4. retry + backoff policy
5. source latency / retry / hash / http status telemetry
6. Postgres snapshot + raw feed repository
7. 独立 provider 数据库 `synapse_gateway_providers`
8. 全源失败时的 persisted snapshot fallback

当前还没落地的内容：

1. 后台预抓取调度器的 lease/state table 仍未完整落地，当前只有 Phase 1 骨架
2. circuit breaker
3. 全量 raw payload 对象存储归档
4. source quality dashboard / replay CLI
5. provider-side rate limiter

## 15. 分阶段推进建议

### Phase 1

1. 抽出 adapters 目录骨架
2. 接入 `Alternative.me`
3. 接入 `Binance`
4. 保留进程内缓存

当前状态：Phase 1 已完成，`Alternative.me` 与 `Binance` adapter 和主流程接入已经落地。

### Phase 2

1. 引入 snapshot 持久化
2. 引入 raw feed 摘要留存
3. 固化 freshness policy 与 scheduler 协作

当前状态：Phase 2 的第 1 步已完成，当前已有 file-backed + PostgreSQL 双实现 repository，可在全源失败时回退最近一次已持久化 snapshot。

补充：Phase 2 的第 2 步已完成，当前 raw feed 摘要与 snapshot 都已落到独立 provider 数据库。

补充：Phase 2 的第 3 步已完成，前台读路径现在按 `fresh / stale-but-servable / expired` 决定直返、异步 repair 或同步补抓。

### Phase 3

1. 补 DexScreener / DefiLlama 增强信号
2. 加失败告警、数据质量监控、回放工具
3. 视效果决定是否引入更复杂的 narrative 生成

## 16. 实施完成判定

只有同时满足以下条件，才能说这项能力真正实现：

1. 当前定义的 source adapter 真实在线抓取
2. sentiment score 来自实时聚合而不是静态 profile
3. snapshot 已持久化
4. raw feed 摘要可追溯
5. 测试覆盖正常、降级、超时、签名校验、缓存和回放路径