# Provider Service 需求挖掘：下载类接口扩展（Twitter / YouTube 之外）

- Status: proposed-v1
- Owner: provider_service
- Last updated: 2026-03-29
- Framework progress: shared download executor (`app/services/download_runtime/executor.py`) 已落地，Twitter/YouTube/TikTok 已迁移到统一执行骨架

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

## 6. 实施优先级（建议）

### Phase A（7 天）

1. `svc_tiktok_video_download`
2. `svc_reddit_media_download`

### Phase B（14 天）

3. `svc_github_release_asset_download`
4. `svc_paper_pdf_download`

### Phase C（30 天）

5. 字幕抽取、音频提取、批量下载异步化、去重缓存层

## 7. 验收口径（面向 Gateway / Agent 调用）

1. 所有下载服务统一使用 `POST /provider-services/<service>/invoke` 骨架。
2. 标准返回结构保持一致：`service`、`sources`、`freshness`、`result`、`errors`。
3. 失败必须产出结构化错误码（如 `*_URL_INVALID`、`*_SIZE_EXCEEDED`、`*_DOWNLOAD_FAILED`）。
4. 所有资产可追溯到 `request_id`、`gateway_request_id`、`asset_key`。
5. 任意下载服务故障时，回放或降级策略可配置且可观测。
