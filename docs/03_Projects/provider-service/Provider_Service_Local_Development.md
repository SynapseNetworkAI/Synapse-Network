# Provider Service Local Development

`provider_service/` 是用于测试“平台接入第三方服务”场景的独立 Python 微服务。

当前运行时主要提供以下接口：

1. `GET /health`
2. `POST /provider-services/web3-sentiment-index/invoke`
3. `POST /provider-services/protocol-fundamental-brief/invoke`
4. `POST /provider-services/smart-contract-audit/invoke`
5. `POST /provider-services/whale-flow-monitor/invoke`
6. `POST /provider-services/oss-security-healthcheck/invoke`
7. `POST /provider-services/twitter-video-download/invoke`
8. `POST /provider-services/youtube-video-download/invoke`
9. `POST /provider-services/tiktok-video-download/invoke`
10. `POST /provider-services/reddit-media-download/invoke`
11. `POST /provider-services/github-release-asset-download/invoke`
12. `POST /provider-services/paper-pdf-download/invoke`
13. `POST /api/v1/quotes/famous`
14. `POST /api/v1/quotes/famous/top3`

## 为什么单独新建一个文件夹

这里采用仓库根目录下独立目录 `provider_service/`，而不是混到 `gateway/` 或 `sdk/python/`：

1. `gateway` 是核心结算网关。
2. `sdk/python` 是开发者客户端代码。
3. `provider_service` 是可独立部署的服务进程，职责边界更清晰。

## 目录结构

```text
provider_service/
├── app/
│   ├── main.py
│   ├── core/config.py
│   ├── api/v1/router.py
│   ├── api/v1/endpoints/quotes.py
│   ├── schemas/quote.py
│   ├── services/deepseek_client.py
│   └── data/famous_quotes_100.json
├── .env.example
├── requirements.txt
├── README.md
└── tests/
```

## 接口说明

### 1. 健康检查

`GET /health`

### 2. 名人名言

`POST /api/v1/quotes/famous`

### 3. 名人名言 Top3

`POST /api/v1/quotes/famous/top3`

## 快速启动

```bash
cd provider_service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./scripts/start.local.sh
```

本地启动脚本现在会主动等待 `http://127.0.0.1:8100/health` 变绿，只有健康检查通过才算启动成功。
如果你要手工验证：

```bash
curl http://127.0.0.1:8100/health
```

本地开发调试默认使用 `local` 环境：

1. 读取 `provider_service/.env.local`
2. 默认走独立 provider PostgreSQL：`synapse_gateway_providers`
3. `DEEPSEEK_API_KEY` 仍可留空
4. `GATEWAY_PROVIDER_SIGNATURE_ENABLED` 本地可设为 `false`，便于直接用 curl 调试 provider 接口
5. `SENTIMENT_SCHEDULER_ENABLED` 是否开启按本地需要决定
6. `SENTIMENT_SCHEDULER_LEASE_TTL_S` 默认建议保持 `120`
7. freshness policy 默认阈值为 `60s / 300s / 900s`
8. PostgreSQL 表结构需先由 `docker-compose/postgres/init/gateway-providers/` 初始化，provider runtime 不会自动建表；scheduler state 依赖 `provider_sentiment_scheduler_jobs`
9. 如果抓取 worker 需要走代理池，设置 `SENTIMENT_PROXY_POOL_ENABLED=true`，并把 `SENTIMENT_PROXY_POOL_URLS_JSON` 配成代理 URL 的 JSON 数组
10. 在 `.env.local` / `.env.staging` / `.env.prod` 里要写成 shell-safe 形式，例如 `SENTIMENT_PROXY_POOL_URLS_JSON='["http://127.0.0.1:7890"]'`，否则脚本 `source` 后会把内部双引号吃掉
11. 开启代理池但没填代理地址时，启动脚本会拒绝启动，避免误配后仍然直连外网
12. 单代理本地联调建议把 `SENTIMENT_PROXY_TIMEOUT_FLOOR_S` 设为至少 `8`，否则代理 connect/read latency 很容易打穿默认单源 timeout
13. 代理模式下 scheduler 会自动按代理池大小收敛刷新并发，避免同一个本地代理被多份快照刷新同时压爆
14. `Protocol Fundamental Brief` 的 Phase 4 缓存策略当前采用 `in-memory hot cache + persisted snapshot fallback`：单机本地调试默认不需要 Redis，只有在多实例共享热缓存时才建议引入
15. `provider_service` 现在统一使用 `PROVIDER_SERVICE_POSTGRES_DSN` 作为共享数据库连接串；protocol brief repository 固定走 postgres，本地不再依赖 file snapshot
16. 如果要验证 protocol brief 持久化回退链路，直接确保 `PROVIDER_SERVICE_POSTGRES_DSN` 指向已初始化的 `synapse_gateway_providers`，同时确认 `docker-compose/postgres/init/gateway-providers/001_provider_schema.sql` 已执行
17. `Smart Contract Audit Model` 的地址模式当前默认走 `Sourcify -> Blockscout -> Etherscan` fallback 链
18. `SOURCIFY_BASE_URL` / `SOURCIFY_TIMEOUT_S` 控制 Sourcify 拉取
19. `BLOCKSCOUT_BASE_URLS_JSON` / `BLOCKSCOUT_TIMEOUT_S` 控制链级 Blockscout explorer fallback
20. `ETHERSCAN_API_KEY`、`ETHERSCAN_BASE_URL`、`ETHERSCAN_TIMEOUT_S` 控制 Etherscan fallback；未配置 API key 时会自动跳过这一层
21. 如果你本地 provider PostgreSQL 里还留着早期 TikTok / Reddit 下载表，runtime 第一次访问会自动补列并兼容旧 schema，不需要手工 drop 表重建

如果需要生产模式脚本入口：

```bash
./scripts/start.prod.sh
```

如果要跑共享测试网 / 联调环境：

```bash
cp .env.staging.example .env.staging
./scripts/start.staging.sh
```

如果要本地直接调 `Web3 Sentiment Index`，有两种方式：

1. 保持 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=true`，按 API 文档生成签名头
2. 把 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`，然后直接用普通 curl 调试

## 测试调用

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'

curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
```

## 本地 curl 冒烟测试

如果你是直接手工 `curl` 调 provider 接口，而不是通过 `gateway -> provider_service` 调用链，建议先在 `provider_service/.env.local` 里确认：

```env
GATEWAY_PROVIDER_SIGNATURE_ENABLED=false
SERVICE_PORT=8100
```

然后重启本地服务：

```bash
cd provider_service
./scripts/restart.local.sh
```

推荐按下面顺序测，先测 `health`，再测简单接口，最后测 provider service invoke 接口。

### 1. 健康检查

```bash
curl http://127.0.0.1:8100/health
```

### 2. Quotes

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'

curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
```

### 3. Web3 Sentiment Index

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/web3-sentiment-index/invoke" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"ETH","chain":"ethereum","lookback_hours":24,"include_narrative":true}'
```

### 4. Smart Contract Audit

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/smart-contract-audit/invoke" \
  -H "Content-Type: application/json" \
  -d '{"source_bundle":"pragma solidity ^0.8.24; contract Demo { function ping() external pure returns (uint256) { return 1; } }","analysis_depth":"fast","include_evidence":true}'
```

### 5. Whale Flow Monitor

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/whale-flow-monitor/invoke" \
  -H "Content-Type: application/json" \
  -d '{"token":"ETH","chain":"ethereum","window_minutes":60,"min_usd_value":100000,"limit":10}'
```

### 6. Protocol Fundamental Brief

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/protocol-fundamental-brief/invoke" \
  -H "Content-Type: application/json" \
  -d '{"protocol":"aave","chain":"ethereum","peer_set":["compound","morpho"],"lookback_days":30}'
```

### 7. GitHub Release Asset Download

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/github-release-asset-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"repo":"openai/openai-python","tag":"v1.0.0","assetPattern":"*.tar.gz","saveMode":"store_and_return"}'
```

### 8. Paper PDF Download

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/paper-pdf-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"paperId":"2401.00001","source":"arxiv","saveMode":"store_and_return"}'
```

### 9. 如果你要保持验签开启

`/provider-services/*/invoke` 这批接口默认会做 `Gateway` 请求验签；如果 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=true`，普通 `curl` 会直接失败。

这时有两种选择：

1. 本地联调时把 `provider_service/.env.local` 的 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`
2. 或者改走真实 `gateway -> provider_service` 链路，由 gateway 代你签名

## 下载类接口如何测试

如果你要测 `twitter / youtube / tiktok / reddit` 这些下载接口，建议分成两层：

1. `curl` 手工打接口，确认路由、校验、响应骨架都通
2. `pytest` 跑对应测试文件，确认成功路径、验签、非法 URL、fallback replay 都正常

前提还是一样：

1. 本地手工 `curl` 时，建议在 `provider_service/.env.local` 里设 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`
2. 如果不关验签，就不要直接 `curl provider_service`，改走 `gateway -> provider_service`

### Twitter / X Video Download

前提配置：

1. 现在 Twitter / X 下载已经不再走匿名网页抓取，必须配置官方 `X API` 凭证
2. 二选一即可：
   `TWITTER_X_API_BEARER_TOKEN=<app bearer token>`
   或
   `TWITTER_X_API_KEY=<consumer key>` + `TWITTER_X_API_SECRET=<consumer secret>`
3. 如果你把 `Consumer Key / Secret` 暴露在聊天记录、截图、共享文档里，应该立刻去 X Developer Portal 重新生成
4. 你的 X app 至少需要具备读公开帖子的权限；否则 provider 会返回 `TWITTER_X_API_AUTH_FAILED`

手工调用：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/twitter-video-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"postUrl":"https://x.com/openai/status/1900000000000000000","preferredQuality":"best","maxDurationSec":300,"maxFileSizeMb":250,"saveMode":"store_and_return","includePreviewImage":true}'
```

自动化回归：

```bash
cd provider_service
./.venv/bin/python -m pytest tests/test_twitter_video_download.py -q
```

重点验证：

1. 合法 `x.com/twitter.com` 链接返回 `200`
2. 非法 URL 返回 `422`
3. 未签名请求在验签开启时返回 `401`
4. 超长/超大资源会在 metadata preflight 或落盘校验阶段被拦住
5. 未配置或配置错误的 X API 凭证时，是否返回 `TWITTER_X_API_CREDENTIALS_MISSING / TWITTER_X_API_AUTH_FAILED`
6. 下载失败时 snapshot fallback 能否回放

### TikTok Video Download

手工调用：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/tiktok-video-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://www.tiktok.com/@openai/video/7499999999999999999","preferredQuality":"best","maxDurationSec":300,"maxFileSizeMb":250,"withSubtitle":false,"saveMode":"store_and_return"}'
```

自动化回归：

```bash
cd provider_service
./.venv/bin/python -m pytest tests/test_tiktok_video_download.py -q
```

重点验证：

1. `videoUrl` 必须是 `https`
2. host 必须是 TikTok 域名
3. 路径必须带 `/video/<id>`
4. `maxFileSizeMb` 生效，超大资源会被 preflight 或落盘后校验拦住
5. 下载超时或时长超限时返回预期错误码

### Reddit Media Download

手工调用：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/reddit-media-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"postUrl":"https://www.reddit.com/r/openai/comments/2abcde/test_post/","maxFileSizeMb":512,"saveMode":"store_and_return"}'
```

自动化回归：

```bash
cd provider_service
./.venv/bin/python -m pytest tests/test_reddit_media_download.py -q
```

重点验证：

1. `postUrl` 必须是 Reddit 合法帖子地址
2. 文件过大时返回 `REDDIT_MEDIA_SIZE_EXCEEDED`
3. 失败后是否能正确走 snapshot fallback

### YouTube Video Download

手工调用：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/youtube-video-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","preferredQuality":"best","maxDurationSec":1800,"maxFileSizeMb":500,"saveMode":"store_and_return"}'
```

自动化回归：

```bash
cd provider_service
./.venv/bin/python -m pytest tests/test_youtube_video_download.py -q
```

重点验证：

1. 支持 `youtube.com/watch` 和 `youtu.be/<id>`
2. 非 YouTube 域名返回 `422`
3. 下载失败时能否回放未过期快照

### 测试这些下载接口时最容易踩的坑

1. 直接 `curl` 但忘了把 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`
2. 贴了 `http://` 链接，schema 直接拒绝
3. `twitter / reddit` 的公开网页经常会因为上游平台策略、区域限制、帖子失效而失败；先区分“样例 URL 无效”还是“provider runtime 真炸了”
4. `youtube` 的 `best` 画质可能会把下载时间和文件体积拉得很高，本地 smoke 建议优先用 `preferredQuality=low`

## 2026-03-31 实际验收样例

下面这些是已经在本地 `provider_service` 上实际打过的样例，方便你快速区分“平台侧问题”还是“我们自己代码问题”。

### 已验证成功

TikTok：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/tiktok-video-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://www.tiktok.com/@sky_shop99/video/7622280119977135381","preferredQuality":"best","maxDurationSec":300,"maxFileSizeMb":250,"withSubtitle":false,"saveMode":"store_and_return"}'
```

YouTube：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/youtube-video-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://www.youtube.com/watch?v=aqz-KE-bpKQ","preferredQuality":"low","maxDurationSec":1800,"maxFileSizeMb":200,"saveMode":"store_and_return"}'
```

### 需要上游凭证的平台说明

Twitter / X：

```bash
export TWITTER_X_API_KEY=replace-me
export TWITTER_X_API_SECRET=replace-me
curl -X POST "http://127.0.0.1:8100/provider-services/twitter-video-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"postUrl":"https://x.com/openai/status/1900000000000000000","preferredQuality":"best","maxDurationSec":300,"maxFileSizeMb":250,"saveMode":"store_and_return","includePreviewImage":true}'
```

当前实现说明：

1. Twitter / X 现在走官方 `X API`，没有凭证就不会再尝试匿名网页抓取
2. 如果 app 权限不足、token 无效、额度打满，会返回结构化错误码：
   `TWITTER_X_API_CREDENTIALS_MISSING`
   `TWITTER_X_API_AUTH_FAILED`
   `TWITTER_X_API_RATE_LIMITED`

Reddit：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/reddit-media-download/invoke" \
  -H "Content-Type: application/json" \
  -d '{"postUrl":"https://www.reddit.com/r/pics/comments/1s2t3so/teenagelooking_ice_agents_walking_around/","maxFileSizeMb":512,"saveMode":"store_and_return"}'
```

当前返回：`HTTP Error 403: Blocked`

Reddit 这类失败更像上游平台对匿名抓取的限制，不是 `provider_service` 本地进程、schema、timeout、subprocess 协议这几层的回归。
3. URL host 对了，但路径不对，比如 Twitter 缺 `/status/`、TikTok 缺 `/video/`
4. 本地没配对象存储 / 下载依赖时，真实下载链路可能失败，这时优先先跑对应 `pytest` 文件确认业务骨架

### 新增的防爆闸门

这批下载接口现在都补了四层保护：

1. metadata preflight：先探测时长/大小，再决定是否真正下载
2. 文件大小限制：Twitter/TikTok 也补上了 `maxFileSizeMb`
3. 总超时：超时后返回结构化 `*_DOWNLOAD_TIMEOUT`
4. 并发限制：每类下载服务都有独立 semaphore，避免带宽和 CPU 被瞬间打满

下载执行模型也已经从 `asyncio.to_thread(...)` 升级成独立 `yt_dlp` subprocess：

1. timeout 触发时，会终止底层下载子进程，不再只是请求侧“放弃等待”
2. client / gateway 提前断开连接时，会触发 provider 侧取消，并终止底层下载子进程
3. 当前取消错误码形态是 `*_DOWNLOAD_CANCELLED`

## 扩展建议

按同样分层扩展：

1. 新接口放 `app/api/v1/endpoints/*.py`。
2. 新模型放 `app/schemas/*.py`。
3. 新外部服务适配放 `app/services/*.py`。
4. 路由层只做参数校验与错误映射。

## 本地测试数据说明

1. 数据文件：`app/data/famous_quotes_100.json`
2. `/famous` 每次返回 1 条。
3. `/famous/top3` 每次连续返回 3 条。
4. 目的是在联调和压测阶段稳定复现，不依赖外部模型服务。

## 相关文档

1. [README.md](./README.md)
2. [Provider_Service_Operations_Runbook.md](./Provider_Service_Operations_Runbook.md)
3. [../../provider_service/README.md](../../provider_service/README.md)
4. [../../provider_service/api/README.md](../../provider_service/api/README.md)
