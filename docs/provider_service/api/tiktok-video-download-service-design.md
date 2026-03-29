# TikTok 视频下载服务设计（Provider Service）

- Status: implemented (runtime + schema + tests)
- Service key: `svc_tiktok_video_download`
- API family: `provider-services/*`
- Storage baseline: MinIO（V1）
- Storage strategy: 抽象 `ObjectStoragePort`，可迁移到 S3 / GCS / Azure Blob

## 1. 背景与目标

为 Agent 生态补齐短视频内容资产获取能力，支持从 TikTok 帖子链接下载视频并生成可消费的对象存储地址。

目标：

1. 给内容理解、营销分析、素材重混 Agent 提供标准下载接口。
2. 保持和 Twitter / YouTube 下载服务一致的响应骨架与审计模式。
3. 采用存储抽象层，V1 使用 MinIO，后续可无缝迁移云存储。

## 2. 典型调用方

1. **内容分析 Agent**：下载视频后做 OCR/ASR/场景识别。
2. **增长运营 Agent**：批量抓取竞品账号公开视频进行素材特征分析。
3. **合规审计 Agent**：对外部视频做取证归档，保留元数据与哈希。

## 3. API 草案

### 3.1 Endpoint

- `POST /provider-services/tiktok-video-download/invoke`
- `GET /health`

### 3.2 Request（V1）

```json
{
  "service": "svc_tiktok_video_download",
  "input": {
    "postUrl": "https://www.tiktok.com/@creator/video/7499999999999999999",
    "preferQuality": "720p",
    "watermarkPolicy": "allow"
  },
  "options": {
    "timeoutMs": 30000,
    "maxFileSizeMb": 200
  }
}
```

字段约束：

1. `postUrl`：必须是 `https` 且 host 属于 `tiktok.com` / `www.tiktok.com` / `vm.tiktok.com`。
2. `preferQuality`：`360p | 720p | 1080p | source`。
3. `watermarkPolicy`：`allow | prefer_no_watermark`（尽力而为，不保证）。
4. `maxFileSizeMb`：默认 `200`，超过即拒绝下载。

### 3.3 Response（统一骨架）

```json
{
  "service": "svc_tiktok_video_download",
  "sources": [
    {
      "kind": "tiktok",
      "uri": "https://www.tiktok.com/@creator/video/7499999999999999999"
    }
  ],
  "freshness": {
    "generatedAt": "2026-03-29T10:00:00Z",
    "ttlSeconds": 259200
  },
  "result": {
    "video": {
      "objectKey": "provider/tiktok/2026/03/29/req_xxx.mp4",
      "bucket": "synapse-provider-assets",
      "contentType": "video/mp4",
      "sizeBytes": 18432000,
      "sha256": "...",
      "durationSec": 31.2,
      "width": 1080,
      "height": 1920
    },
    "meta": {
      "platform": "tiktok",
      "authorHandle": "@creator",
      "postId": "7499999999999999999",
      "watermark": true
    }
  },
  "errors": []
}
```

## 4. 架构设计

分层与现有下载服务对齐：

1. `endpoint`：鉴权、入参校验、request_id 注入。
2. `service orchestrator`：拉起 downloader -> 存储 -> 持久化 -> 组装响应。
3. `downloader adapter`：封装 `yt-dlp` 或可替换 provider SDK。
4. `storage adapter`：`MinioStorageAdapter`（实现 `ObjectStoragePort`）。
5. `repository`：写入资产元数据和调用审计（支持回放）。

## 5. 数据存储设计（建议）

建议新增表：`provider_tiktok_video_assets`

核心字段：

1. `id` (bigserial pk)
2. `request_id` (text unique)
3. `gateway_request_id` (text)
4. `service` (text default `svc_tiktok_video_download`)
5. `post_url` (text)
6. `post_id` (text)
7. `author_handle` (text)
8. `object_key` (text)
9. `bucket` (text)
10. `content_type` (text)
11. `size_bytes` (bigint)
12. `sha256` (text)
13. `duration_sec` (numeric)
14. `width` / `height` (int)
15. `watermark` (boolean)
16. `status` (text: `success | fallback | failed`)
17. `expires_at` (timestamptz)
18. `created_at` / `updated_at`

同时复用 `provider_api_invocations` 做 append-only 调用审计。

## 6. 错误码设计

1. `TIKTOK_URL_INVALID`
2. `TIKTOK_DOWNLOAD_FAILED`
3. `TIKTOK_MEDIA_NOT_FOUND`
4. `TIKTOK_FILE_TOO_LARGE`
5. `TIKTOK_STORAGE_UPLOAD_FAILED`
6. `TIKTOK_SNAPSHOT_FALLBACK_USED`
7. `TIKTOK_SNAPSHOT_NOT_FOUND`

## 7. 安全与合规边界

1. 仅允许公开可访问内容，不绕过平台访问控制。
2. 禁止下载私密/受限内容。
3. 对 URL 做白名单与 SSRF 防护（仅 tiktok host）。
4. 对文件大小、MIME、扩展名做三重校验。
5. 默认对象私有读，返回短期签名 URL 或内部对象键。
6. 全链路记录 request_id/gateway_request_id 便于审计与追踪。

## 8. 可迁移存储策略

统一接口：

```text
ObjectStoragePort.put_object(bytes, key, content_type, metadata) -> StoredObject
ObjectStoragePort.get_presigned_url(key, expires_sec) -> str
```

适配器路线：

1. V1：`MinioStorageAdapter`
2. V2：`S3StorageAdapter` / `GCSStorageAdapter`
3. V3：冷热分层（对象存储 + CDN）

迁移原则：

1. 业务层只依赖 `ObjectStoragePort`。
2. object key 命名规范保持稳定：`provider/tiktok/YYYY/MM/DD/<request_id>.mp4`。
3. 通过配置切换 backend，不修改 endpoint contract。

## 9. 里程碑计划

1. **Phase A（2 天）**：接口、schema、downloader、MinIO 上传打通。
2. **Phase B（1 天）**：资产表 + 调用审计落库，补齐 fallback replay。
3. **Phase C（1 天）**：限流、内容大小治理、告警与观测面板。

## 10. 验收标准

1. 有效 TikTok URL 可返回 `200` 且对象已上传 MinIO。
2. 下载失败可回放未过期快照（若存在），并返回 `TIKTOK_SNAPSHOT_FALLBACK_USED`。
3. 表内可按 `post_id`、`request_id`、`expires_at` 查询资产记录。
4. 切换存储 backend 后 API contract 不变。
