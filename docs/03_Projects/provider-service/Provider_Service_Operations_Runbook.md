# Provider Service Operations Runbook

适用目录：`/Users/cliff/workspace/Synapse-Network/provider_service`

目标：快速完成依赖安装、环境配置、服务启动、接口验证与基本运维排查。

## 1. 运行环境要求

1. OS: macOS / Linux
2. Python: `3.10+`，建议 `3.11`
3. 当前本地 JSON 模式下无外部依赖

建议先确认：

```bash
python3 --version
```

## 2. 安装依赖

### 2.1 进入项目目录

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
```

### 2.2 创建并激活虚拟环境

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2.3 安装 Python 依赖

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

## 3. 配置环境变量

### 3.1 环境文件约定

```bash
cp .env.example .env
```

脚本启动约定：

1. 本地开发默认使用 `provider_service/.env.local`
2. 生产模式脚本使用 `provider_service/.env.prod`
3. `provider_service/.env` 仍可保留给手工直跑 `uvicorn` 的兼容路径
4. `provider_service/.env.example` 为模板文件，现已标注中文用途、是否必填、以及代码默认值

### 3.2 当前最小配置

```env
SERVICE_HOST=0.0.0.0
SERVICE_PORT=8100
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_S=30
SENTIMENT_REPOSITORY_BACKEND=postgres
PROVIDER_SERVICE_POSTGRES_DSN=postgresql://synapse:12345678@localhost:5432/synapse_gateway_providers
SENTIMENT_POSTGRES_SNAPSHOT_TABLE=provider_sentiment_snapshots
SENTIMENT_POSTGRES_RAW_FEED_TABLE=provider_sentiment_raw_feeds
SENTIMENT_POSTGRES_SCHEDULER_JOB_TABLE=provider_sentiment_scheduler_jobs
SENTIMENT_PROXY_POOL_ENABLED=false
SENTIMENT_PROXY_POOL_URLS_JSON='[]'
SENTIMENT_PROXY_TIMEOUT_FLOOR_S=8
SENTIMENT_SCHEDULER_ENABLED=false
SENTIMENT_SCHEDULER_INTERVAL_S=30
SENTIMENT_SCHEDULER_MAX_CONCURRENT_SNAPSHOTS=2
SENTIMENT_SCHEDULER_LEASE_TTL_S=120
SENTIMENT_SCHEDULER_TARGETS_JSON=
SENTIMENT_SCHEDULER_FRESH_TTL_S=60
SENTIMENT_SCHEDULER_STALE_TTL_S=300
SENTIMENT_SCHEDULER_HARD_EXPIRE_S=900
GATEWAY_PROVIDER_SIGNATURE_ENABLED=true
GATEWAY_PROVIDER_SIGNATURE_SECRET=replace-this-with-a-provider-signature-secret
SOURCIFY_BASE_URL=https://sourcify.dev
SOURCIFY_TIMEOUT_S=6
BLOCKSCOUT_BASE_URLS_JSON='{"ethereum":"https://eth.blockscout.com/api","arbitrum":"https://arbitrum.blockscout.com/api","optimism":"https://optimism.blockscout.com/api","base":"https://base.blockscout.com/api"}'
BLOCKSCOUT_TIMEOUT_S=6
ETHERSCAN_BASE_URL=https://api.etherscan.io/v2/api
ETHERSCAN_TIMEOUT_S=6
ETHERSCAN_API_KEY=
```

说明：

1. 当前代码路径实际使用本地 JSON 数据源，不依赖 `DEEPSEEK_API_KEY`。
2. 保留 `DEEPSEEK_*` 变量是为了后续切回真实模型时直接复用。
3. postgres repository 现在统一复用 `PROVIDER_SERVICE_POSTGRES_DSN`，不再为 sentiment / protocol brief 维护两套 DSN。
4. `GATEWAY_PROVIDER_SIGNATURE_ENABLED` 控制是否强制校验 Gateway 签名；生产环境必须保持 `true`。
5. `GATEWAY_PROVIDER_SIGNATURE_SECRET` 是 Gateway 与 Provider 共享的 HMAC 密钥；只要开启验签就必须配置真实值。
5. 当前 sentiment scheduler 已支持持久化 lease / cooldown 状态表；本地是否开启取决于调试目标，生产环境可按白名单热点 symbol 开启。
6. `SENTIMENT_SCHEDULER_LEASE_TTL_S` 控制 per-snapshot lease TTL，默认建议 `120s`。
7. 当前读路径已支持 `fresh / stale-but-servable / expired` 三档 freshness policy，默认阈值分别是 `60s / 300s / 900s`。
8. `provider_sentiment_snapshots`、`provider_sentiment_raw_feeds`、`provider_sentiment_scheduler_jobs` 必须通过 `docker-compose/postgres/init/gateway-providers/` 的显式 SQL 链路预创建，runtime repository 不再执行建表或补列。
9. `SENTIMENT_PROXY_POOL_ENABLED` 控制抓取 worker 是否通过代理池出站；开启后会按 `SENTIMENT_PROXY_POOL_URLS_JSON` 中的 URL 做轮转。
10. `SENTIMENT_PROXY_POOL_URLS_JSON` 必须是 JSON 数组；如果写在 `.env.*` 文件里，要用单引号包住整串，例如 `'["http://proxy-a.internal:8080","http://proxy-b.internal:8080"]'`。
11. `SENTIMENT_PROXY_TIMEOUT_FLOOR_S` 是代理模式下的最小 timeout floor；单代理环境建议至少 `8` 秒。
12. 代理模式下 scheduler 刷新并发会自动被限制到代理池大小，避免单代理环境被多快照并发压爆。
13. `Smart Contract Audit Model` 的地址模式当前按 `Sourcify -> Blockscout -> Etherscan` 顺序回退。
14. `SOURCIFY_BASE_URL` 默认官方服务地址，`SOURCIFY_TIMEOUT_S` 控制单次 Sourcify verified-source 抓取超时。
15. `BLOCKSCOUT_BASE_URLS_JSON` 是链到 explorer API base URL 的 JSON 映射；写在 `.env.*` 时要用单引号包住整串 JSON。
16. `ETHERSCAN_API_KEY` 为空时，Etherscan fallback 会自动跳过，不会阻塞主链。

## 4. 启动服务

### 4.1 本地开发模式

```bash
./scripts/start.local.sh
```

启动脚本会额外打印一行配置摘要，至少包括：

1. 当前 backend
2. scheduler 是否开启
3. scheduler 轮询周期
4. gateway 验签是否开启
5. 抓取代理池是否开启
6. 当前使用的 env 文件
7. 当前数据库目标

额外安全护栏：

1. 如果用 `prod` 环境启动，同时 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`，启动脚本默认直接拒绝启动
2. 只有显式设置 `ALLOW_INSECURE_PROD_START=true`，才会放行这次危险启动
3. 即使放行，脚本仍会打印红字安全警报，明确提示你当前把生产环境跑成了“关闭验签”的危险状态
4. 如果 `SENTIMENT_PROXY_POOL_ENABLED=true` 但 `SENTIMENT_PROXY_POOL_URLS_JSON` 为空，启动脚本也会直接拒绝启动，避免抓取 worker 假装走代理、实际仍然直连

停止与重启：

```bash
./scripts/stop.local.sh
./scripts/restart.local.sh
```

### 4.2 生产模式

```bash
./scripts/start.prod.sh
```

停止与重启：

```bash
./scripts/stop.prod.sh
./scripts/restart.prod.sh
```

如果需要绕过脚本手工直跑 `uvicorn`，可继续使用：

```bash
./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8100
```

## 5. 验证服务可用

### 5.1 健康检查

```bash
curl http://127.0.0.1:8100/health
```

预期返回：

```json
{"status":"ok"}
```

### 5.2 测试 1 条名言接口

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于勇气"}'
```

### 5.3 测试 3 条名言接口

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
```

### 5.4 测试 TikTok 下载接口

前提：

1. 本地若只做 endpoint / schema / replay 联调，可保留 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`
2. 若保持验签开启，则按 Gateway HMAC 约定补齐签名头

请求体样例：

```json
{
  "videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999",
  "preferredQuality": "best",
  "maxDurationSec": 300,
  "withSubtitle": false
}
```

### 5.5 测试 Reddit 下载接口

请求体样例：

```json
{
  "postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/",
  "maxFileSizeMb": 512
}
```

### 5.6 测试 GitHub Release Asset 下载接口

请求体样例：

```json
{
  "repo": "openai/openai-python",
  "tag": "v1.0.0",
  "assetPattern": "*.tar.gz"
}
```

说明：

1. `tag` 与 `latest=true` 二选一。
2. 当前 Phase B 骨架会返回统一 `asset.storageKey + metadata`，并保留 `signatureVerified` 字段；验签值当前默认 `false`，后续再补校验链路。

### 5.7 测试 Paper PDF 下载接口

请求体样例：

```json
{
  "paperId": "2401.00001",
  "source": "arxiv"
}
```

说明：

1. 当前骨架优先支持 arXiv `paperId` / `paperUrl`；`openalex|crossref` 入口先保留契约位，等待后续解析器接入。
2. 返回体统一包含 `pdf.storageKey` 与 `metadata`（title/authors/year/doi）。

### 5.8 TikTok / Reddit Phase A 错误码矩阵

| Service | Error code | 含义 | 运维动作 |
| --- | --- | --- | --- |
| TikTok | `TIKTOK_VIDEO_DURATION_EXCEEDED` | 请求声明的 `maxDurationSec` 小于目标视频时长 | 调整调用方阈值或拒绝该素材 |
| TikTok | `TIKTOK_VIDEO_DOWNLOAD_FAILED` | live 下载失败且没有可回放 snapshot | 检查上游可达性、yt-dlp 能力和目标 URL 可用性 |
| TikTok | `TIKTOK_VIDEO_SNAPSHOT_FALLBACK_USED` | live 下载失败，但已回放最近未过期 snapshot | 视为降级成功，重点排查上游抖动与下载链路健康 |
| Reddit | `REDDIT_MEDIA_SIZE_EXCEEDED` | 目标媒体超过 `maxFileSizeMb` 限制 | 提高阈值或改为异步/离线处理大文件 |
| Reddit | `REDDIT_MEDIA_DOWNLOAD_FAILED` | live 下载失败且没有可回放 snapshot | 检查 Reddit 帖子可见性、资源可达性和下载器状态 |
| Reddit | `REDDIT_MEDIA_SNAPSHOT_FALLBACK_USED` | live 下载失败，但已回放最近未过期 snapshot | 视为降级成功，重点排查上游抖动与下载链路健康 |

### 5.9 幂等回放 / snapshot 行为

1. TikTok / Reddit 都以请求字段生成稳定 `asset_key`。
2. 同请求在 TTL 内再次调用时，runtime 直接回放已持久化结果，不再重复下载。
3. 幂等回放时：
   - `freshness.cacheHit=true`
   - `errors` 保持空数组
   - `provider_api_invocations` 审计记录标记 `cache_hit=true`
4. 若 live 下载失败但历史 snapshot 仍有效，则返回 `*_SNAPSHOT_FALLBACK_USED`，表示这是“失败后降级回放”，不是“正常幂等命中”。

## 6. 常见问题排查

### 问题 1: 想接真实模型，但 `DEEPSEEK_API_KEY` 为空

1. 如果只是跑本地 JSON demo，可忽略。
2. 如果在扩展真实模型能力，再补齐 `.env`。

### 问题 2: 接口返回 500 或 503

常见原因：

1. 本地 JSON 数据文件缺失。
2. JSON 格式损坏。
3. 未来切回外部模型后，上游不可达或超时。

处理：

1. 检查 `app/data/famous_quotes_100.json` 是否存在且为合法 JSON 数组。
2. 运行测试确认本地 fixture 正常。
3. 如果接了真实模型，再检查 `DEEPSEEK_*` 配置与网络连通性。

### 问题 3: 端口占用

改端口：修改对应环境文件中的 `SERVICE_PORT`，例如 `provider_service/.env.local`。

```bash
./scripts/restart.sh local
```

释放占用端口：

```bash
lsof -i :8100
kill -9 <PID>
```

### 问题 4: `ModuleNotFoundError`

处理：

1. 始终使用项目虚拟环境解释器启动。
2. 如果提示 `No module named 'app'`，请在 `provider_service` 目录执行，或追加 `--app-dir /Users/cliff/workspace/Synapse-Network/provider_service`。

## 7. 建议运维流程

1. 拉取最新代码。
2. 激活 `.venv`。
3. `pip install -r requirements.txt`。
4. 更新 `provider_service/.env.local` 或 `provider_service/.env.prod`。
5. 用对应环境脚本启动服务，例如 `./scripts/start.local.sh` 或 `./scripts/start.prod.sh`。
6. 先打 `health`，再打业务接口。
7. 如改了 schema 或数据源，执行 `./.venv/bin/python -m pytest tests -q`。

## 8. 服务扩展约定

后续新增接口时遵循：

1. 路由：`app/api/v1/endpoints/*.py`
2. 模型：`app/schemas/*.py`
3. 外部调用：`app/services/*.py`
4. 配置：`app/core/config.py`
