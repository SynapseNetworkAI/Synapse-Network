# Provider 需求设计：通过 YouTube 视频地址下载视频

- Status: supplementary
- Owner: provider_service
- Service id (proposed): `svc_youtube_video_download`
- Service name (proposed): `YouTube Video Downloader`

## 1. 目标

新增一个 Provider Service：输入 YouTube 视频 URL，Provider 负责下载视频并写入对象存储，返回结构化视频资产结果。

核心目标：

1. 标准化接口：`POST /provider-services/youtube-video-download/invoke`。
2. V1 存储后端采用 **MinIO**。
3. 存储层抽象可切换，后续可迁移到云存储（GCS/S3/Azure Blob）而不改业务编排。

## 2. 服务边界

### In Scope

1. URL 解析与合法性校验（youtube.com / youtu.be）。
2. 视频下载编排（quality 选择、时长限制、大小限制）。
3. 上传到 MinIO。
4. 元数据落库和调用审计。
5. 下载失败时快照回放（可选）。

### Out of Scope

1. 平台结算与预算逻辑。
2. 大规模转码工作流（V1 不做）。
3. 公网 CDN 分发策略（V1 只返回存储键/签名 URL）。

## 3. API 草案

## 3.1 Endpoint

- `POST /provider-services/youtube-video-download/invoke`
- 鉴权：Gateway 签名（沿用 `require_gateway_signature`）

## 3.2 Request Schema (draft)

```json
{
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "preferredQuality": "best",
  "maxDurationSec": 1800,
  "maxFileSizeMb": 500,
  "saveMode": "store_and_return"
}
```

字段：

1. `videoUrl`：必填。
2. `preferredQuality`：`best | medium | low`。
3. `maxDurationSec`：最大时长限制。
4. `maxFileSizeMb`：最大文件大小限制。
5. `saveMode`：V1 固定 `store_and_return`。

当前运行时保护：

1. 下载前会先做 metadata preflight，尽量在真正拉流前拦住超长/超大资源
2. 下载执行已经从线程模式切到独立 `yt_dlp` subprocess，timeout / disconnect 会终止底层子进程
3. Provider 侧有总超时闸门，避免单请求长时间占住 worker
4. Provider 侧有并发限制，避免瞬时下载把带宽和 CPU 打满

## 3.3 Response Schema (draft)

```json
{
  "service": {
    "serviceId": "svc_youtube_video_download",
    "serviceName": "YouTube Video Downloader",
    "version": "1.0.0"
  },
  "sources": [{ "name": "youtube_public_web", "freshnessSec": 0 }],
  "freshness": {
    "generatedAt": "2026-03-29T12:00:00Z",
    "maxSourceAgeSec": 0,
    "cacheHit": false
  },
  "result": {
    "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "videoId": "dQw4w9WgXcQ",
    "status": "downloaded",
    "video": {
      "storageKey": "youtube/2026/03/29/dQw4w9WgXcQ/video.mp4",
      "storageBackend": "minio",
      "mimeType": "video/mp4",
      "sizeBytes": 104857600,
      "durationSec": 212,
      "width": 1920,
      "height": 1080,
      "sha256": "..."
    }
  },
  "errors": []
}
```

## 4. 架构设计

```text
API Router
  -> YouTubeDownloadService (orchestrator)
    -> URL validator
    -> Downloader adapter (yt-dlp)
    -> Storage adapter (MinIO first)
    -> Metadata repository (Postgres)
```

分层原则：

1. Router：验签、参数、日志。
2. Service：下载流程编排。
3. Repository：资产快照 + 调用审计。
4. Storage：统一接口，具体实现可替换。

## 5. MinIO 存储设计（V1）

## 5.1 存储 key 规则

`youtube/{yyyy}/{mm}/{dd}/{video_id}/{filename}`

## 5.2 配置草案

```env
VIDEO_STORAGE_BACKEND=minio
VIDEO_STORAGE_KEY_PREFIX=youtube
VIDEO_STORAGE_MINIO_ENDPOINT=localhost:9000
VIDEO_STORAGE_MINIO_ACCESS_KEY=minioadmin
VIDEO_STORAGE_MINIO_SECRET_KEY=minioadmin
VIDEO_STORAGE_MINIO_BUCKET=synapse-youtube-videos
VIDEO_STORAGE_MINIO_SECURE=false
```

## 5.3 开放性设计（后续迁移云存储）

1. 定义统一接口 `VideoStorage`（`put_file/get_signed_url/delete`）。
2. 当前实现 `MinioVideoStorage`。
3. 后续新增：
   - `S3VideoStorage`
   - `GCSVideoStorage`
   - `AzureBlobVideoStorage`
4. 通过 `VIDEO_STORAGE_BACKEND` 选择实现，业务 service 不感知具体云厂商。

## 6. 数据落库设计

建议新增表：`provider_youtube_video_assets`

字段建议：

1. `asset_key` (PK)
2. `video_id`, `video_url`, `channel_id`, `title`
3. `storage_backend`, `storage_key`
4. `mime_type`, `size_bytes`, `duration_sec`, `width`, `height`, `sha256`
5. `download_status`, `error_code`, `error_message`
6. `generated_at`, `expires_at`, `created_at`, `updated_at`

复用：`provider_api_invocations` 记录调用链路。

## 7. 错误码建议

1. `YOUTUBE_URL_INVALID`
2. `YOUTUBE_VIDEO_NOT_FOUND`
3. `YOUTUBE_VIDEO_DURATION_EXCEEDED`
4. `YOUTUBE_VIDEO_SIZE_EXCEEDED`
5. `YOUTUBE_VIDEO_DOWNLOAD_FAILED`
6. `YOUTUBE_STORAGE_WRITE_FAILED`
7. `YOUTUBE_VIDEO_SNAPSHOT_FALLBACK_USED`

## 8. 安全与合规

1. 仅允许 YouTube 官方域名。
2. SSRF 防护（禁止内网与 metadata 地址）。
3. 限制下载时长、文件大小、下载超时。
4. 默认私有对象存储，返回短期签名 URL（可选）。
5. 全链路保留 `request_id`、`gateway_request_id`、`asset_key`。

## 9. Phase 规划

### Phase 1

1. 同步下载 + MinIO 上传。
2. 元数据落库。
3. 标准化 invoke 返回。

### Phase 2

1. 异步任务下载（队列）。
2. 下载重试策略与限流。
3. 快照回放 + 自动清理。

### Phase 3

1. 多云存储后端切换。
2. 数据跨存储迁移工具。
3. 转码与多清晰度产物。

## 10. 验收标准

1. 输入合法 YouTube URL 可返回 `downloaded` 和有效 `storageKey`。
2. 对象存在于 MinIO 目标 bucket。
3. 元数据表和 `provider_api_invocations` 有完整记录。
4. 切换存储后端时，业务 service 无需改动。


## 11. V1 实现落地说明

1. 已落地 endpoint：`POST /provider-services/youtube-video-download/invoke`。
2. 下载器实现基于 `yt-dlp`，存储适配器当前落地 `MinIO`。
3. 结果写入 `provider_youtube_video_assets`，调用审计写入 `provider_api_invocations`。
4. live 下载失败时，若存在未过期快照则回放并返回 fallback 错误标记。

## 12. 上线前红线清单（一页纸）

> 目标：让 `youtube-video-download` 以“可迁移、可回滚、可观测、可告警”的最低风险形态上线。

### 12.1 迁移红线（Migration）

1. 只允许通过显式 SQL 初始化链路执行 `009_provider_youtube_video_schema.sql`，禁止 runtime 隐式建表。
2. 上线前在目标环境执行一次只读验证：
   - 表存在：`provider_youtube_video_assets`
   - 索引存在：`idx_provider_youtube_video_assets_video_id`、`idx_provider_youtube_video_assets_created_at`
   - 权限存在：`gateway_app` 对表 `SELECT/INSERT/UPDATE`
3. 迁移窗口内必须冻结对应服务的 schema 变更，避免“半迁移半发布”。
4. 任一校验失败立即终止发布，不允许“先发服务再补表”。

### 12.2 回滚红线（Rollback）

1. 代码回滚优先：保留 DB 表，不做破坏性 DDL 回滚（禁止 `DROP TABLE`）。
2. 回滚触发条件（满足任一条立即触发）：
   - `YOUTUBE_VIDEO_DOWNLOAD_FAILED` 在 5 分钟窗口内持续超过阈值；
   - MinIO 写入失败持续超过阈值；
   - p95 延迟连续 10 分钟超出 SLO。
3. 回滚后必须确认：
   - endpoint 不再处理新下载请求（或返回明确降级错误）；
   - 数据表可读可查，审计链路不断裂；
   - 回放快照路径仍可用于故障追溯。

### 12.3 依赖红线（Dependencies）

1. `yt-dlp` 版本锁定并纳入镜像构建，不允许线上临时 `pip install` 热修。
2. MinIO 连接参数必须由环境变量注入，禁止代码硬编码凭证。
3. 启动前健康检查必须覆盖：
   - Postgres 可连通；
   - MinIO bucket 可写；
   - 临时下载目录可写且空间充足。
4. 依赖任一项不满足时，服务应 fail-fast，而不是静默降级为不落库/不存储。

### 12.4 监控红线（Monitoring）

必须至少落以下四类指标（按 `service=youtube-video-download` 维度）：

1. **流量与成功率**
   - 请求总量、成功量、失败量、成功率
2. **性能**
   - 端到端耗时 p50/p95/p99
   - 下载阶段耗时、上传阶段耗时
3. **资源与约束**
   - 视频大小分布、时长分布
   - 超限拒绝计数（duration/size exceeded）
4. **回放与一致性**
   - 快照命中率
   - fallback 使用次数
   - “有审计无资产”与“有资产无审计”不一致计数

### 12.5 告警红线（Alerting）

1. **P1（立即处理）**
   - 连续 5 分钟成功率低于 95%
   - MinIO 写入错误率持续高于 3%
   - 审计写入失败（`provider_api_invocations`）出现连续错误
2. **P2（当日闭环）**
   - p95 延迟高于基线 2 倍并持续 15 分钟
   - 快照 fallback 使用率异常升高（疑似上游下载不可用）
3. 告警必须包含最小定位字段：`request_id`、`gateway_request_id`、`asset_key`、`error_code`。

### 12.6 发布闸门（Go/No-Go）

只有当以下条件全部满足才允许 `Go`：

1. DDL 校验通过；
2. 冒烟请求可完成“下载→上传→落库→审计”全链路；
3. 监控面板与告警规则已生效；
4. 回滚预案已演练且值班人确认在线；
5. Runbook 已同步到值班文档并确认可执行。
