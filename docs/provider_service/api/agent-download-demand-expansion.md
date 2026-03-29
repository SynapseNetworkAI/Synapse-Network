# Provider Service 需求挖掘：下载类接口扩展（Twitter / YouTube 之外）

- Status: supplementary
- Owner: provider_service
- Last updated: 2026-03-29

## 0. 实施状态（2026-03-29）

1. **Phase A 核心链路已落地**
   - `POST /provider-services/tiktok-video-download/invoke`
   - `POST /provider-services/reddit-media-download/invoke`
   - 已完成 request / response schema、endpoint wiring、service 编排、Gateway 验签、MinIO 存储、资产元数据落库、调用审计记录、snapshot fallback。
2. **Phase A 仍有收口项未完成**
   - 已补齐 TikTok / Reddit 的 `资源超限`、`无快照时下载失败`、`同请求幂等回放` 回归断言。
   - 运行手册与失败码矩阵已补齐 TikTok / Reddit Phase A 闭环说明。
3. **Phase B 骨架已落地**
   - `github-release-asset-download`
   - `paper-pdf-download`
   - 已落地：request / response schema、endpoint wiring、typed repository、MinIO 存储、snapshot replay、调用审计、Postgres 表结构。
   - 当前边界：`signatureVerified` 已出现在 GitHub 响应里，但骨架阶段默认 `false`；Paper 入口当前优先支持 arXiv，`openalex|crossref` 解析器留待后续接入。
4. **Phase C 尚未开工**
   - 还没有平台级 `DownloadPolicy`、`DownloadJob`、`MediaAsset`、`SnapshotRepository`、`StorageGateway`、`ComplianceGuard` 抽象。
   - 当前复用仍以 Twitter / YouTube / TikTok / Reddit 各自 service + repository 组合为主，离“平台下载框架”还有一层基础设施收敛工作。

## 1. 目标

在现有 `twitter-video-download` 与 `youtube-video-download` 的基础上，继续扩展“可被其他 Agent 直接调用”的下载能力，优先覆盖：

1. 高频内容分发平台（社媒/UGC）
2. 高频工作流资产（文档/数据集/发布包）
3. Agent 常见后处理需求（字幕、音频、批量归档、去重、签名 URL）

核心原则：**不做裸下载器，而是做“可审计、可限额、可重放、可编排”的下载服务层**。

## 2. 除了 Twitter 和 YouTube，还应支持哪些网站

> 下面是按“Agent 调用价值”而不是“平台热度”排序。

### P0（应优先落地）

1. **TikTok / Douyin 国际版镜像内容**
   - 场景：增长 Agent 抓取竞品投放素材、脚本 Agent 做短视频脚本分析。
   - 价值：短视频是最高频内容源之一，和 YouTube/Twitter 形成三角覆盖。
   - 建议服务：`svc_tiktok_video_download`

2. **Reddit（帖子视频/GIF/图集）**
   - 场景：舆情 Agent、社区研究 Agent 抓热点素材。
   - 价值：UGC 密度高，文本+媒体融合，便于构建“事件证据包”。
   - 建议服务：`svc_reddit_media_download`

3. **GitHub Releases / Assets**
   - 场景：CI Agent、安全 Agent 自动拉取二进制发布包并做哈希校验与 SBOM 流程。
   - 价值：直接服务开发和供应链场景，商业价值高于纯内容下载。
   - 建议服务：`svc_github_release_asset_download`

4. **ArXiv / OpenAlex 论文 PDF**
   - 场景：研究 Agent 批量下载论文并进入摘要/RAG 流程。
   - 价值：和现有研究类 API 强耦合，可形成“检索→下载→摘要”闭环。
   - 建议服务：`svc_paper_pdf_download`

### P1（第二梯队）

5. **Vimeo**
   - 场景：品牌/教育内容分析 Agent 下载课程片段做结构化解析。
   - 建议服务：`svc_vimeo_video_download`

6. **Dailymotion / Bilibili（合规范围内）**
   - 场景：区域市场增长 Agent 对比多平台内容策略。
   - 建议服务：`svc_regional_video_download`

7. **IPFS / Arweave 公共资源**
   - 场景：Web3 Agent 拉取链上关联文件（白皮书、前端包、元数据）。
   - 建议服务：`svc_web3_content_download`

8. **Podcast RSS（音频文件）**
   - 场景：资讯 Agent 做语音转文本与趋势提炼。
   - 建议服务：`svc_podcast_audio_download`

## 3. 其他 Agent 的下载需求（不止“拿到文件”）

下载只是第一步，真实需求通常是“下载 + 后处理 + 交付”。

1. **字幕与文本资产**
   - 能力：下载视频后自动产出 `srt/vtt/txt`。
   - 调用方：研究 Agent、内容总结 Agent、客服质检 Agent。

2. **音视频分离与音频提取**
   - 能力：仅提取音轨（mp3/wav）用于 ASR 和情绪分析。
   - 调用方：语音 Agent、播客分析 Agent。

3. **批量下载任务**
   - 能力：一次提交 URL 列表，异步返回 job 与分片进度。
   - 调用方：增长 Agent、爬取 Agent、数据准备 Agent。

4. **去重与资产复用**
   - 能力：基于 `content_hash` 与 canonical URL 去重，避免重复下载。
   - 调用方：成本敏感的批处理 Agent、缓存重放 Agent。

5. **统一对象存储交付**
   - 能力：下载后统一写 MinIO/S3，并返回短期签名 URL + 元数据。
   - 调用方：下游工作流 Agent（摘要、翻译、分类、审计）。

6. **合规与策略控制**
   - 能力：按域名白名单、文件大小、时长、MIME 类型、地理区域策略限流。
   - 调用方：企业合规 Agent、安全 Agent。

## 4. 新增服务提案（放入 provider_service 生态）

## 4.1 `svc_tiktok_video_download`

- Endpoint（建议）：`POST /provider-services/tiktok-video-download/invoke`
- Request 关键字段：
  - `videoUrl`
  - `preferredQuality`
  - `maxDurationSec`
  - `withSubtitle`（可选）
- Response 关键字段：
  - `video.storageKey`
  - `video.sha256`
  - `subtitle.storageKey`（可选）
  - `downloadTrace`（source platform / fallback info）

## 4.2 `svc_reddit_media_download`

- Endpoint（建议）：`POST /provider-services/reddit-media-download/invoke`
- 覆盖媒体：`video | image_set | gif`
- 关键特性：帖子元信息（subreddit、post_id、author、created_utc）与媒体资产一起落库。

## 4.3 `svc_github_release_asset_download`

- Endpoint（建议）：`POST /provider-services/github-release-asset-download/invoke`
- 输入：
  - `repo`（`owner/name`）
  - `tag` 或 `latest=true`
  - `assetPattern`（可选）
- 输出：
  - `assetName`
  - `sizeBytes`
  - `sha256`
  - `storageKey`
  - `signatureVerified`（是否完成校验）

## 4.4 `svc_paper_pdf_download`

- Endpoint（建议）：`POST /provider-services/paper-pdf-download/invoke`
- 输入：
  - `paperUrl` 或 `paperId`
  - `source`（`arxiv|openalex|crossref`）
- 输出：
  - `pdf.storageKey`
  - `metadata`（title/authors/year/doi）
  - `textExtractJobId`（可选，供后续摘要链路）

## 5. 能力抽象建议（避免每个下载服务重复造轮子）

建议在 `provider_service` 内统一收敛为可复用下载框架：

1. `DownloadPolicy`：域名白名单、大小/时长阈值、超时、并发配额
2. `DownloadJob`：同步/异步统一任务对象
3. `MediaAsset`：统一资产元模型（hash、mime、size、duration、storage_key）
4. `SnapshotRepository`：快照与回放策略统一
5. `StorageGateway`：MinIO/S3 后端切换统一
6. `ComplianceGuard`：平台条款、robots、区域策略控制

## 6. 实现计划（可直接开工版本，与当前状态对齐）

### Phase A（7 天）

目标接口：

1. `svc_tiktok_video_download`
2. `svc_reddit_media_download`

落地步骤与当前状态：

1. **新增 schema（request / response / error code）**
   - 状态：**已完成**
   - 已实现：TikTok / Reddit request / response schema 已落地。
   - 已补齐：面向 Phase A 的失败码矩阵已在本页与运行手册同步。
2. **新增 endpoint：`app/api/v1/endpoints/*`，并在 `router.py` 注册**
   - 状态：**已完成**
   - 已落地：
     - `app/api/v1/endpoints/tiktok_video_download.py`
     - `app/api/v1/endpoints/reddit_media_download.py`
     - `app/api/v1/router.py` 已完成注册
3. **新增 service：下载编排 + 元数据提取 + 审计记录**
   - 状态：**已完成**
   - 已落地：
     - `app/services/tiktok_video_download_service.py`
     - `app/services/reddit_media_download_service.py`
     - 均已写入调用审计记录并落库存档快照
4. **复用现有 MinIO + 元数据落库模式（对齐 Twitter / YouTube 已有路径）**
   - 状态：**已完成**
   - 已落地：两条链路都复用 `build_video_storage()`、Postgres / in-memory repository、snapshot fallback 形态
5. **加测试：成功、URL 非法、资源超限、下载失败、幂等回放**
   - 状态：**已完成**
   - 已完成：成功、URL 非法、资源超限、无快照下载失败、幂等回放、snapshot fallback
6. **文档同步：接口说明 + 运行手册 + 失败码矩阵**
   - 状态：**已完成**
   - 已完成：项目 README、本地开发文档、下载扩展专题文档、运维手册、失败码矩阵同步收敛

### Phase B（14 天）

目标接口：

1. `svc_github_release_asset_download`
2. `svc_paper_pdf_download`

落地步骤与当前状态：

1. **GitHub 资产下载：`repo/tag/assetPattern` 解析与校验**
   - 状态：**已完成（骨架）**
2. **Paper 下载：`paperUrl/paperId/source` 统一入口**
   - 状态：**已完成（骨架）**
3. **加哈希 / 签名校验字段（`sha256`, `signatureVerified`）**
   - 状态：**部分完成**
   - 说明：`sha256` 与 `signatureVerified` 已落在响应契约；签名验证逻辑仍待后续 hardening。
4. **输出统一 `storageKey + metadata` 对象**
   - 状态：**已完成（骨架）**
5. **回放 / 降级策略接入（失败可观测）**
   - 状态：**已完成（骨架）**

### Phase A 失败码矩阵（当前已落地）

| Service | Error code | 触发条件 | 当前行为 |
| --- | --- | --- | --- |
| `svc_tiktok_video_download` | `TIKTOK_VIDEO_DURATION_EXCEEDED` | 下载资源时长超过 `maxDurationSec` | 返回 `502` 结构化错误 |
| `svc_tiktok_video_download` | `TIKTOK_VIDEO_DOWNLOAD_FAILED` | live 下载失败且无可用 snapshot | 返回 `502` 结构化错误 |
| `svc_tiktok_video_download` | `TIKTOK_VIDEO_SNAPSHOT_FALLBACK_USED` | live 下载失败但命中未过期 snapshot | 返回 `200`，`freshness.cacheHit=true`，并在 `errors` 追加 fallback 标记 |
| `svc_reddit_media_download` | `REDDIT_MEDIA_SIZE_EXCEEDED` | 媒体大小超过 `maxFileSizeMb` | 返回 `502` 结构化错误 |
| `svc_reddit_media_download` | `REDDIT_MEDIA_DOWNLOAD_FAILED` | live 下载失败且无可用 snapshot | 返回 `502` 结构化错误 |
| `svc_reddit_media_download` | `REDDIT_MEDIA_SNAPSHOT_FALLBACK_USED` | live 下载失败但命中未过期 snapshot | 返回 `200`，`freshness.cacheHit=true`，并在 `errors` 追加 fallback 标记 |

### Phase A 幂等回放口径（当前已落地）

1. TikTok / Reddit 均使用 request canonical fields 计算 `asset_key`。
2. 当同请求再次到达且命中未过期 snapshot 时，直接返回已持久化响应，不再触发 live 下载。
3. 幂等回放响应表现为：
   - `freshness.cacheHit=true`
   - `errors=[]`
   - 调用审计记录保留 `cache_hit=true` 与 `replayReason=IDEMPOTENT_SNAPSHOT_REPLAY`

### Phase C（30 天）

目标：

1. 字幕抽取
2. 音频提取
3. 批量异步
4. 去重缓存

基础设施抽象与当前状态：

1. `DownloadPolicy`
   - 状态：**未实现**
2. `DownloadJob`
   - 状态：**未实现**
3. `MediaAsset`
   - 状态：**未实现**（当前只有各服务私有 asset schema / record）
4. `SnapshotRepository`
   - 状态：**未实现**（当前只有按服务拆开的 repository）
5. `StorageGateway`
   - 状态：**未实现**（当前主要复用视频下载存储封装，还不是统一下载基础设施）
6. `ComplianceGuard`
   - 状态：**未实现**

## 7. 验收口径（面向 Gateway / Agent 调用）

1. 所有下载服务统一使用 `POST /provider-services/<service>/invoke` 骨架。
2. 标准返回结构保持一致：`service`、`sources`、`freshness`、`result`、`errors`。
3. 失败必须产出结构化错误码（如 `*_URL_INVALID`、`*_SIZE_EXCEEDED`、`*_DOWNLOAD_FAILED`）。
4. 所有资产可追溯到 `request_id`、`gateway_request_id`、`asset_key`。
5. 任意下载服务故障时，回放或降级策略可配置且可观测。
