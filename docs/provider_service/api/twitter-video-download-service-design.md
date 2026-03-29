# Provider 需求设计：通过帖子链接下载 Twitter/X 视频

- Status: implemented-v1
- Owner: provider_service
- Service id (proposed): `svc_twitter_video_download`
- Service name (proposed): `Twitter Video Downloader`

## 1. 背景与目标

新增一个 Provider 服务能力：输入帖子链接（tweet/x post URL），由 Provider 侧拉取并下载可用视频资源，返回可访问的文件信息与元数据。

目标：

1. Agent 通过标准 `invoke` 直接请求下载。
2. 下载文件先落本地存储（V1）。
3. 存储层抽象为可切换适配器，后续可平滑切换到开源对象存储（MinIO/Ceph）或云厂商付费平台（GCS/S3）。

## 2. 服务边界

### 2.1 In Scope

1. URL 规范化和基础校验。
2. 下载流程编排（解析 -> 选择视频源 -> 下载 -> 存储 -> 返回结果）。
3. Provider 侧文件元数据落库与调用审计。
4. 可切换存储后端适配器。

### 2.2 Out of Scope

1. Gateway 计费、预算、结算。
2. 长期 CDN 分发与公开分享治理。
3. 大规模异步转码（V1 不做）。

## 3. API 设计（草案）

## 3.1 Endpoint

- `POST /provider-services/twitter-video-download/invoke`
- 认证：沿用 `require_gateway_signature`

## 3.2 Request Schema (draft)

```json
{
  "postUrl": "https://x.com/<user>/status/<tweet_id>",
  "preferredQuality": "best",
  "maxDurationSec": 300,
  "saveMode": "store_and_return",
  "includePreviewImage": true
}
```

字段说明：

1. `postUrl`：必填，帖子链接。
2. `preferredQuality`：`best | medium | low`。
3. `maxDurationSec`：防止超长视频。
4. `saveMode`：V1 固定 `store_and_return`。
5. `includePreviewImage`：是否带封面图信息。

## 3.3 Response Schema (draft)

```json
{
  "service": {
    "serviceId": "svc_twitter_video_download",
    "serviceName": "Twitter Video Downloader",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "x_public_web", "freshnessSec": 0 }
  ],
  "freshness": {
    "generatedAt": "2026-03-29T12:00:00Z",
    "maxSourceAgeSec": 0,
    "cacheHit": false
  },
  "result": {
    "postUrl": "https://x.com/...",
    "tweetId": "1900000000000000000",
    "status": "downloaded",
    "video": {
      "storageKey": "twitter/2026/03/29/1900.../video.mp4",
      "storageBackend": "local_fs",
      "mimeType": "video/mp4",
      "sizeBytes": 10485760,
      "durationSec": 43,
      "width": 1280,
      "height": 720,
      "sha256": "..."
    },
    "previewImage": {
      "storageKey": "twitter/2026/03/29/1900.../cover.jpg",
      "mimeType": "image/jpeg"
    }
  },
  "errors": []
}
```

## 4. 运行架构

```text
API Endpoint
  -> Download Service (orchestrator)
    -> URL Parser / Validator
    -> Source Resolver (tweet -> media url)
    -> Downloader (streaming HTTP)
    -> Storage Adapter (local/minio/gcs...)
    -> Metadata Repository (postgres)
```

原则：

1. 路由层只做鉴权、日志、schema。
2. 业务编排在 service。
3. 持久化在 repository。
4. 存储实现通过 adapter 注入，不与业务耦合。

## 5. 存储可切换设计

## 5.1 抽象接口

建议定义统一接口：

```python
class VideoStorage(Protocol):
    def put_file(self, *, source_path: str, target_key: str, content_type: str) -> StoredObject: ...
    def get_signed_url(self, *, key: str, ttl_s: int) -> str | None: ...
    def delete(self, *, key: str) -> None: ...
```

## 5.2 V1: Local FS Adapter

- backend id: `local_fs`
- base dir: `provider_service/storage/twitter_videos/`
- key 规则：`twitter/{yyyy}/{mm}/{dd}/{tweet_id}/{filename}`

## 5.3 后续可切换后端

1. 开源：`minio` / `ceph-rgw`（S3 兼容）。
2. 云付费：`gcs` / `aws_s3`。
3. 切换方式：`VIDEO_STORAGE_BACKEND` 环境变量 + provider factory。

## 5.4 配置草案

```env
VIDEO_STORAGE_BACKEND=local_fs
VIDEO_STORAGE_LOCAL_BASE_DIR=storage/twitter_videos
VIDEO_STORAGE_PUBLIC_URL_BASE=
VIDEO_STORAGE_SIGNED_URL_TTL_S=3600
VIDEO_STORAGE_S3_ENDPOINT=
VIDEO_STORAGE_S3_BUCKET=
VIDEO_STORAGE_S3_ACCESS_KEY=
VIDEO_STORAGE_S3_SECRET_KEY=
VIDEO_STORAGE_GCS_BUCKET=
VIDEO_STORAGE_GCS_CREDENTIALS_JSON=
```

## 6. 元数据落库设计（草案）

推荐新增表：`provider_twitter_video_assets`

关键字段：

1. `asset_key`（PK）
2. `tweet_id`, `post_url`, `author_handle`
3. `storage_backend`, `storage_key`
4. `mime_type`, `size_bytes`, `duration_sec`, `width`, `height`, `sha256`
5. `download_status`, `error_code`, `error_message`
6. `created_at`, `updated_at`, `expires_at`

并继续复用：`provider_api_invocations` 做统一审计。

## 7. 错误码建议

1. `TWITTER_URL_INVALID`
2. `TWEET_NOT_FOUND`
3. `VIDEO_NOT_FOUND_IN_POST`
4. `VIDEO_DURATION_EXCEEDED`
5. `VIDEO_DOWNLOAD_FAILED`
6. `STORAGE_WRITE_FAILED`
7. `TWITTER_VIDEO_SNAPSHOT_FALLBACK_USED`（如果后续引入回放）

## 8. 安全与合规

1. 仅允许 HTTPS 的 X/Twitter 合法域名。
2. 对 URL 做 SSRF 防护（禁止内网地址、metadata 地址）。
3. 下载过程限制大小和时长。
4. 文件访问默认私有，返回短期签名 URL（非本地模式时）。
5. 落库前保存 `sha256` 防篡改追踪。

## 9. Phase 规划

### Phase 1（当前需求）

1. 同步下载 + 本地存储。
2. 元数据落库。
3. 返回 storage key + 基本视频信息。

### Phase 2

1. 存储适配器扩展到 MinIO/S3/GCS。
2. 引入异步下载队列与状态查询。
3. 增加自动清理（TTL）和配额治理。

### Phase 3

1. 扩展多平台（YouTube、TikTok 等）统一媒体下载契约。
2. 可选转码流水线（分辨率压缩、格式统一）。

## 10. 验收标准

1. 给定合法帖子 URL，能返回 `downloaded` 状态和有效 `storageKey`。
2. 文件实际落地到配置的存储后端。
3. `provider_api_invocations` 与 `provider_twitter_video_assets` 都有记录。
4. 切换 `VIDEO_STORAGE_BACKEND` 后无需改业务编排代码。


## 11. V1 实现落地说明

1. 已落地 endpoint：`POST /provider-services/twitter-video-download/invoke`。
2. 下载器实现基于 `yt-dlp`，存储适配器当前落地 `MinIO`。
3. 结果写入 `provider_twitter_video_assets`，调用审计写入 `provider_api_invocations`。
4. live 下载失败时，若存在未过期快照则回放并返回 fallback 错误标记。
