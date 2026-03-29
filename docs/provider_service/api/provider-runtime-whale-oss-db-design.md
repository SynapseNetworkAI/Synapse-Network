# Provider Runtime 数据库设计：Whale Flow Monitor + OSS Security Healthcheck

- Status: canonical-for-implementation
- Scope: `svc_whale_flow_monitor`, `svc_oss_security_healthcheck`
- Database: `synapse_gateway_providers`

## 1. 这两个接口是否需要数据库存储

结论：**需要**，且建议分两层。

1. 公共调用审计层（必需）
   - 表：`provider_api_invocations`
   - 目的：统一记录每次 invoke 的输入、状态码、错误码、延迟、请求链路 ID。
2. 服务级快照层（建议）
   - `svc_whale_flow_monitor`：`provider_whale_flow_snapshots`
   - `svc_oss_security_healthcheck`：`provider_oss_security_reports`
   - 目的：缓存最近一次结构化结果、支持降级回退、支持观测和复盘。

> 边界说明：这些表只服务 Provider Runtime 的缓存与观测，不承担 Gateway 计费、账本、结算语义。

## 2. 表设计概览

## 2.1 `provider_whale_flow_snapshots`

主键与维度：

- `snapshot_key` (PK)
- 维度字段：`token`, `chain`, `window_minutes`, `min_usd_value`

时效与可观测：

- `source_count`, `max_source_age_sec`
- `generated_at`, `expires_at`, `updated_at`

结果数据：

- `response_json`：完整响应快照（JSONB）

索引建议：

1. `(token, chain, updated_at DESC)`：按资产查询最新快照
2. `(expires_at)`：清理任务扫描过期数据

## 2.2 `provider_oss_security_reports`

主键与检索：

- `report_key` (PK)
- `repo_url_hash`：repo 模式快速检索
- `package_fingerprint`：依赖模式去重与缓存键

业务元数据：

- `ecosystem`, `dependency_count`, `vulnerability_count`, `repo_health_score`

时效与可观测：

- `generated_at`, `expires_at`, `updated_at`

结果数据：

- `response_json`：完整响应快照（JSONB）

索引建议：

1. `(repo_url_hash, updated_at DESC)`：repo 维度查询
2. `(package_fingerprint, updated_at DESC)`：依赖清单维度查询
3. `(expires_at)`：过期清理

## 3. 生命周期与TTL建议

1. Whale Flow：高频、时效强，建议默认 TTL `5~15 分钟`。
2. OSS Healthcheck：变化相对慢，建议默认 TTL `1~6 小时`。
3. 过期策略：保留最近一次可用快照，写入新快照前不删旧数据；由后台清理任务按 `expires_at` 清理历史行。

## 4. 幂等与一致性

1. `provider_api_invocations` 按请求写 append-only 审计。
2. 快照表使用 upsert（`ON CONFLICT ... DO UPDATE`）保持最新视图。
3. 严格禁止在 runtime repository 中隐式 DDL；表结构变更统一走 init SQL + apply shell。

## 5. 安全与权限

1. `synapse_provider_app`：`SELECT/INSERT/UPDATE/DELETE`
2. `synapse_provider_ro`：`SELECT`
3. `response_json` 需 `jsonb_typeof(...) = 'object'` 约束，避免异常 payload。
