# OSS Security Healthcheck 实现设计（V1）

- service_id: `svc_oss_security_healthcheck`
- endpoint: `POST /provider-services/oss-security-healthcheck/invoke`
- status: implemented (deterministic runtime + postgres snapshot replay)

## 1. 目标

把 `OSS Security Healthcheck` 落地为可签名调用的 Provider API，返回结构化仓库/依赖安全体检结果，先满足冷启动货架的“可调用 + 可展示 + 可测试”。

## 2. 功能边界

### 输入

- `repoUrl`（可选）
- `packageList`（可选）
- `ecosystem`（可选：`npm/pypi/mixed`）

约束：`repoUrl` 与 `packageList` 至少提供一个。

### 输出

- 标准响应骨架：`service/sources/freshness/result/errors`
- `result.repo_health_score`
- `result.vulnerability_matches`
- `result.maintainer_activity`
- `result.dependency_risk_summary`
- `result.upgrade_advice`

## 3. 运行流程

1. Router 执行 Gateway 签名鉴权。
2. Schema 执行输入归一化与“至少一个目标”校验。
3. Service 基于请求字段计算确定性分数（便于测试稳定）。
4. 根据依赖列表生成漏洞匹配（V1 规则集为 deterministic demo）。
5. 生成风险摘要与升级建议。
6. 返回标准响应对象。

## 4. V1 规则策略

1. `lodash`、`requests==2.19.x` 命中示例漏洞规则。
2. 其余依赖返回低风险结论。
3. 输出中保留 `advisory_id/fixed_version` 结构，后续可平滑接入 OSV 实时结果。

## 5. 后续演进

1. 接入 GitHub REST API（活跃度、最近提交、issue 维护状态）。
2. 接入 OSV.dev（真实漏洞数据）。
3. 支持 `requirements.txt/package-lock.json` 原始文件解析。
4. 接入 provider-side snapshot 缓存与错误降级。


## 6. 存储设计

V1 推荐接入：

1. 公共审计表：`provider_api_invocations`。
2. 服务快照表：`provider_whale_flow_snapshots` / `provider_oss_security_reports`。
3. 具体字段、索引与 TTL 见：`provider-runtime-whale-oss-db-design.md` 与 `007_provider_whale_oss_schema.sql`。


## 7. 当前落地形态（生产化升级）

1. endpoint 调用 `execute_oss_security_healthcheck`，请求成功会写 `provider_oss_security_reports` 与 `provider_api_invocations`。
2. live runtime 异常时，会读取最近未过期快照并回放，`freshness.cacheHit=true`，并附带 `OSS_SECURITY_SNAPSHOT_FALLBACK_USED`。
3. 当 `PROVIDER_SERVICE_POSTGRES_DSN` 缺失时，自动退化为 in-memory repository（仅本地开发/测试）。
