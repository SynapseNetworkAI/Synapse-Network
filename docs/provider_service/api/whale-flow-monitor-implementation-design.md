# Whale Flow Monitor 实现设计（V1）

- service_id: `svc_whale_flow_monitor`
- endpoint: `POST /provider-services/whale-flow-monitor/invoke`
- status: implemented (deterministic runtime + postgres snapshot replay)

## 1. 目标

V1 目标是把 `Whale Flow Monitor` 先落成**稳定可调用**的 Provider Runtime 接口，满足 Gateway 端到端调度与签名调用演示，不阻塞后续接入真实上游（Blockscout / DexScreener / RPC）。

## 2. 功能边界

### 输入

- `token`：代币符号或合约地址
- `chain`：链标识（如 `ethereum`）
- `window_minutes`：监控窗口（默认 60）
- `min_usd_value`：大额阈值（默认 100000）
- `limit`：返回事件条数上限（默认 10）

### 输出

- 标准响应骨架：`service/sources/freshness/result/errors`
- `result.events`：结构化巨鲸事件
- `result.net_direction`：`net_inflow | net_outflow | mixed`
- `result.market_impact_guess`：面向 Agent 的可执行语义摘要

## 3. 运行流程

1. Router 先做 Gateway 签名鉴权。
2. Service 读取请求并生成确定性 seed（基于请求字段哈希）。
3. 按 seed 构造事件列表（时间戳、金额、方向、标签、摘要）。
4. 根据事件方向聚合 `net_direction`。
5. 生成 `watchlist_matches` 与 `market_impact_guess`。
6. 返回标准响应对象。

## 4. 为什么先用确定性 mock

1. 保证单元测试稳定，不依赖外部网络。
2. 保持契约先行，后续可无缝替换真实 adapter。
3. Gateway/SDK 联调优先验证协议层而不是数据源质量。

## 5. 后续演进

1. 接入真实上游适配器（Blockscout + DexScreener）。
2. 加入本地快照缓存和回退策略。
3. 增加地址标签来源配置（静态标签表 + Provider 自定义标签）。
4. 增加可观测性落库（invocation + snapshot + raw feed records）。


## 6. 存储设计

V1 推荐接入：

1. 公共审计表：`provider_api_invocations`。
2. 服务快照表：`provider_whale_flow_snapshots` / `provider_oss_security_reports`。
3. 具体字段、索引与 TTL 见：`provider-runtime-whale-oss-db-design.md` 与 `007_provider_whale_oss_schema.sql`。


## 7. 当前落地形态（生产化升级）

1. endpoint 调用 `execute_whale_flow_monitor`，请求成功会写 `provider_whale_flow_snapshots` 与 `provider_api_invocations`。
2. live runtime 异常时，会读取最近未过期快照并回放，`freshness.cacheHit=true`，并附带 `WHALE_FLOW_SNAPSHOT_FALLBACK_USED`。
3. 当 `PROVIDER_SERVICE_POSTGRES_DSN` 缺失时，自动退化为 in-memory repository（仅本地开发/测试）。
