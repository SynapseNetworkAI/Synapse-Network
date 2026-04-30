# Discovery Service Troubleshooting SQL

## 1. 目标

本文件用于排查以下典型问题：

1. `synapse_service_endpoints` 里已经有 endpoint 记录，但 `/api/v1/services/discover` 返回空
2. Provider 侧认为服务已注册，但 Discovery 页面看不到该服务
3. Service 已经 `active`，但 Agent 仍然无法 discover 到该服务

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/agent/discovery/search" \
  -H "Content-Type: application/json" \
  -H "X-Credential: agt_3884fb46bcfb8aa27f6388eb93d12c3b0ebae0da939141dd" \
  -H "X-Request-Id: req_discovery_001" \
  -d '{
    "query": "famous",
    "tags": [],
    "page": 1,
    "pageSize": 10,
    "sort": "best_match"
  }'
```

结论先说透：

**Discovery 不是“endpoint 表里有一行就显示”，而是“Service Registry 聚合成功 + 服务状态 active + 至少一个 target 在健康窗口内 healthy” 才显示。**

## 2. Discovery 真实过滤链路

Discovery 列表依赖以下事实链：

1. `synapse_service_manifests` 中存在该 `service_id`
2. 该 service 的 manifest `status = active`
3. `synapse_service_endpoints` 中至少存在一个有效 endpoint
4. `synapse_service_health_snapshots` 中存在该 service 的健康快照
5. 健康快照未过期，且至少一个 endpoint 为 `healthy`

如果只满足第 3 条，不满足第 4/5 条，Discovery 页面仍然不会显示该服务。

## 3. 最小排查 SQL

### 3.1 先确认 manifest 主体是否存在

```sql
SELECT service_id, service_name, status, created_at, updated_at
FROM synapse_service_manifests
WHERE service_id = 'famous_quotes_top3';
```

判断标准：

1. 必须能查到一行
2. `status` 必须是 `active`

### 3.2 再确认 endpoint 记录是否存在

```sql
SELECT endpoint_id,
       service_id,
       endpoint_url,
       auth_mode,
       timeout_ms,
       max_payload_bytes,
       streaming_supported,
       async_supported,
       callback_supported,
       region,
       weight,
       is_primary,
       status,
       created_at,
       updated_at
FROM synapse_service_endpoints
WHERE service_id = 'famous_quotes_top3'
ORDER BY is_primary DESC, created_at ASC;
```

判断标准：

1. 至少存在一条 endpoint
2. 期望主 endpoint 的 `status = active`
3. 注意 `endpoint_url` 是否是 Gateway 运行上下文可达地址，特别是 `127.0.0.1`

### 3.3 最关键：确认健康快照是否存在

```sql
SELECT sh.service_id,
       sh.endpoint_id,
       sh.health_score,
       sh.p95_latency_ms,
       sh.last_checked_at,
       sh.error_code,
       ep.endpoint_url,
       ep.status AS endpoint_status
FROM synapse_service_health_snapshots sh
JOIN synapse_service_endpoints ep ON ep.endpoint_id = sh.endpoint_id
WHERE sh.service_id = 'famous_quotes_top3';
```

判断标准：

1. 查不到记录：Discovery 一定不会显示
2. `last_checked_at` 太旧：健康结果可能已过期
3. `error_code` 非空：说明最近探活失败
4. `endpoint_status` 不是 `active`：该 endpoint 不会进入在线可发现集合
5. **即使有快照，只要 `health_score < 80`，当前实现也会被映射成 `unhealthy`，Discovery 仍然不会显示**

## 4. 建议补充 SQL

### 4.1 一次性看 manifest + endpoint 主视图

```sql
SELECT sm.service_id,
       sm.service_name,
       sm.status AS manifest_status,
       sm.base_price_usdc,
       sm.settlement_currency,
       ep.endpoint_id,
       ep.endpoint_url,
       ep.status AS endpoint_status,
       ep.is_primary,
       ep.updated_at AS endpoint_updated_at
FROM synapse_service_manifests sm
LEFT JOIN synapse_service_endpoints ep ON ep.service_id = sm.service_id
WHERE sm.service_id = 'famous_quotes_top3'
ORDER BY ep.is_primary DESC, ep.created_at ASC;
```

用途：

1. 快速判断 manifest 和 endpoint 是否已经对齐
2. 确认是不是只有 endpoint 落库，而 manifest 没有同步完成

### 4.2 一次性看 discoverability 关键字段

```sql
SELECT sm.service_id,
       sm.service_name,
       sm.status AS manifest_status,
       ep.endpoint_url,
       ep.status AS endpoint_status,
       sh.health_score,
       sh.p95_latency_ms,
       sh.last_checked_at,
       sh.error_code
FROM synapse_service_manifests sm
LEFT JOIN synapse_service_endpoints ep ON ep.service_id = sm.service_id
LEFT JOIN synapse_service_health_snapshots sh
       ON sh.service_id = sm.service_id
      AND sh.endpoint_id = ep.endpoint_id
WHERE sm.service_id = 'famous_quotes_top3'
ORDER BY ep.is_primary DESC, ep.created_at ASC;
```

用途：

1. 一屏看清是否卡在健康探测环节
2. 判断是“服务没注册完整”还是“服务已注册但未上线”

## 5. 常见根因对照表

### 5.1 endpoint 有记录，但 discovery 为空

常见根因：

1. `synapse_service_manifests` 没有对应 `service_id`
2. manifest `status != active`
3. `synapse_service_health_snapshots` 里没有记录
4. 健康快照过期
5. Gateway 探测 `endpoint_url` 失败

### 5.2 `127.0.0.1` endpoint 探测失败

常见根因：

1. Gateway 和 Provider 不在同一进程/容器网络上下文
2. 对 Provider 来说是本机地址，对 Gateway 来说不是目标服务
3. 本地手工 curl 通，但 Gateway 后台探活不通

建议：

1. 本地开发优先确认 Gateway 进程自己能访问该 URL
2. 容器场景优先改为 service name / container DNS，不要默认依赖 `127.0.0.1`

### 5.3 有健康快照，但 `health_score = 0`，Discovery 仍然为空

这是最容易误判的一类。

现象：

1. `synapse_service_manifests` 有记录
2. `synapse_service_endpoints` 有记录
3. `synapse_service_health_snapshots` 也有记录
4. 但 `/api/v1/services/discover` 仍然返回空

根因：

1. Discovery 不是“只要有健康快照就算在线”
2. 当前实现会把健康快照映射成 target status
3. 如果 runtime state 没有显式写入 `status = healthy`，系统会退化为按 `health_score >= 80` 判定 healthy
4. 当 `health_score = 0` 时，target 会被判定为 `unhealthy`
5. `is_service_discoverable(...)` 只接受至少一个 `healthy` target，因此该 service 仍然不会进入 Discovery 列表

对应代码语义：

1. `health_score >= 80` 才会退化映射为 `healthy`
2. `is_service_discoverable(...)` 只统计 `row.status == healthy` 的 target

额外注意：

1. target URL 是 `http://127.0.0.1:8100/api/v1/quotes/famous/top3`，不代表健康探测就打这个路径
2. 默认健康探测路径是 `/health`
3. 也就是说，Gateway 默认实际探测的是 `http://127.0.0.1:8100/health`
4. 如果你的 Provider 没有暴露 `/health`，或者该接口没有稳定返回 200，健康分就会持续上不去

建议动作：

1. 先确认 Provider 是否实现了 `/health`
2. 确认该 `/health` 从 Gateway 进程所在环境可访问
3. Gateway 重启后会把所有 target 先标记为 `stale`，必须等新一轮 `/health` 返回 200 后才重新进入 Discovery

### 5.4 Health Monitor 刷新被外键卡死，导致 Discovery 因 stale health 归零

现象：

1. `/api/v1/services/health/status?includeInactive=true` 能看到 service 仍然存在，但 `health.probeStatus = healthy`、`health.overallStatus = stale`、`runtimeAvailable = false`
2. `/api/v1/services/discover` 或 `/api/v1/agent/discovery/search` 却返回空
3. 日志出现 `synapse_service_quotes_service_id_fkey` 之类的外键错误

根因：

1. Discovery 真正的放行条件不是“最近一次 probe 看起来 healthy”，而是 target health 必须处在有效时间窗口内
2. 如果 health monitor 在刷新过程中试图重写 `synapse_service_manifests`，会被 quote / execution 等外键引用阻断
3. 一旦刷新线程持续失败，`last_checked_at` 不再推进，service 最终会因为 stale health 被 `is_service_discoverable(...)` 过滤掉

现状说明：

1. `health.overallStatus` 现在已经和 discovery 共享同一套有效状态语义
2. 如果最近一次探活本身是健康的，但已经超出 stale window，会显示为 `probeStatus = healthy`、`overallStatus = stale`
3. `runtimeAvailable` 是 Agent 真正能不能发现/调用到该 service 的最终开关
4. Gateway 启动时会 fail closed：即使重启前 snapshot 是 healthy，也会先写成 `stale`，再通过限流 worker pool 平滑探活恢复

建议动作：

1. 先看 Gateway 日志里是否存在 manifest delete/update 被外键阻断的报错
2. 确认健康刷新只更新 `synapse_service_health_snapshots` 与 runtime health 元数据，不要全表重写 manifest
3. 修复后重新触发一次 health refresh，再验证 `/api/v1/services/discover` 是否恢复
4. 如需自定义探测路径，在 service manifest 的 `healthCheck.path` 中显式配置
5. 等待 `/health` 新探针返回 200 后，再重新访问 `/api/v1/services/discover`

## 6. 排查顺序

固定按下面顺序查，不要跳步：

1. 查 `synapse_service_manifests`
2. 查 `synapse_service_endpoints`
3. 查 `synapse_service_health_snapshots`
4. 确认 `last_checked_at` 是否仍在健康窗口内
5. 确认 Gateway 运行环境是否真的能访问 `endpoint_url`

## 7. 结论

Discovery 页空，不等于数据库没有数据；更常见的是：

**Service 已注册，但还没有通过“在线可发现”门禁。**

在 Synapse 里，`registered` 和 `discoverable` 不是同一个状态。前者只代表配置落库，后者代表该服务在当前时刻真的可以被 Agent 安全发现并路由调用。

Gateway 重启后的短暂空列表是安全设计：所有服务先 `stale`，然后按 `SERVICE_HEALTH_MAX_CONCURRENCY`、`SERVICE_HEALTH_REHYDRATE_WINDOW_SEC` 和 stable jitter 平滑探活。不要把 `marketplace.total=0` 直接解读为注册丢失；必须同时查看 `registeredServices / discoverableServices / staleServices / unavailableServices`。
