# Reddit 媒体下载服务设计（Provider Service）

- Status: supplementary
- Service key: `svc_reddit_media_download`
- Endpoint: `POST /provider-services/reddit-media-download/invoke`
- Storage: MinIO（通过统一 `build_video_storage`）

## 1. V1 能力

1. 输入 Reddit 帖子 URL，下载媒体并存储到对象存储。
2. 返回统一骨架：`service/sources/freshness/result/errors`。
3. 支持落库快照与失败回放（snapshot fallback）。

## 2. 数据持久化

- 资产表：`provider_reddit_media_assets`
- 调用审计：`provider_api_invocations`

关键索引：

1. `post_id, updated_at DESC`
2. `expires_at`

## 3. 错误码

1. `REDDIT_MEDIA_DOWNLOAD_FAILED`
2. `REDDIT_MEDIA_FILE_TOO_LARGE`
3. `REDDIT_MEDIA_SNAPSHOT_FALLBACK_USED`

## 4. 统一执行骨架

Reddit 服务复用了 `provider_service/app/services/download_runtime/executor.py`，和 Twitter/YouTube/TikTok 共用同一套：

1. 成功路径落库 + invocation append
2. 失败路径 snapshot fallback replay
3. 统一 502 错误对象
