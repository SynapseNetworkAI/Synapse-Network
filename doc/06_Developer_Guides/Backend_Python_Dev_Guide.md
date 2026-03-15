# Synapse Network Python 后端与 SDK 运维启动指南 (Operation Guide)

本文档说明如何从零开始配置环境、安装依赖，并基于最新的 **同步支付微服务架构 (Sync Payment & FastAPI)** 启动本地完整测试节点和客户端。

*(注：历史旧流程已下线，当前采用同步支付路由 + Web2 鉴权验证模式。)*

## 1. 环境准备 (Python 环境与依赖)

本服务基于 Python 开发，推荐使用 Python 3.9+ 环境。
在开始之前，确保您已经在项目根目录，并切入了 `python_sdk` 文件夹：

```bash
cd python_sdk
```

### 1.1 创建与激活虚拟环境
为防止依赖冲突，强烈建议创建隔离的虚拟环境：

**Mac/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

### 1.2 安装依赖包
目前所有的基础 Web3 和 FastAPI 服务依赖已被集成：
```bash
pip install -r requirements.txt
```

*(可选) 如果遇到某些加密库缺少 C++ 编译环境，请确保已安装 `build-essential` (Linux) 或 Xcode 命令行工具 (Mac)。*

## 2. 一键启动本地集群 (推荐)

为简化启动流程，我们在根目录提供了 `scripts/local/setup_local_env.sh` 脚本。它将一键完成：
- 启动 **Hardhat 本地链** (`127.0.0.1:8545`)
- 部署 **Synapse NetworkSyncRouter + MockUSDC**
- 自动读取 `frontend/src/contract-config.json` 并注入 Seller API 所需环境变量
- 自动优先使用 `python_sdk/venv/bin/python`（若存在），并在缺依赖时自动安装 `python_sdk/requirements.txt`
- 后台启动 `python_sdk/seller_fastapi.py`
- 后台启动 `frontend`（`npm run dev`）

请在**项目根目录**（Synapse Network）打开一个新的终端窗口并执行：
```bash
chmod +x scripts/local/setup_local_env.sh
./scripts/local/setup_local_env.sh
```

**运行成功后，系统将自动就绪：**
* **Hardhat Node** 正在本地 `127.0.0.1:8545` 运行并产出区块。
* **部署逻辑** 已自动将新的合约 ABI 生成到 `python_sdk/Synapse NetworkSyncRouterABI.json` 以供后端中间件调用。
* **Seller API Gateway** (V1 网关) 运行在 `http://127.0.0.1:8000/api/v1/gateway/generate`。
* **Frontend Next.js** 运行在 `http://127.0.0.1:3000`。
* 脚本会输出 `TX_HASH` 测试前置脚本命令，以及本次启动的 PID。

要停止测试集群，可以使用日志中打印出的 PIDs 进行 `kill`，或直接关闭发起脚本的终端进程。

推荐使用一键停止脚本：
```bash
chmod +x scripts/local/stop_local_env.sh
./scripts/local/stop_local_env.sh
```

如需“一键重启”（先停再起）：
```bash
chmod +x scripts/local/restart_local_env.sh
./scripts/local/restart_local_env.sh
```

说明：`scripts/local/restart_local_env.sh` 会在重启完成后自动执行 V2 日限额回归烟测（`python_sdk/examples/v2_daily_limit_regression.py`），并在失败时返回非 0。

若仅需快速重启、不跑烟测：
```bash
SKIP_V2_SMOKE=1 ./scripts/local/restart_local_env.sh
```

## 2.1 生产环境启动脚本（仅 Seller API）

生产环境脚本位于 `scripts/prod/`，只管理 `python_sdk/seller_fastapi.py`，不启动 Anvil，也不会执行 `deploy_anvil.js`。

```bash
chmod +x scripts/prod/start_prod_env.sh scripts/prod/restart_prod_env.sh scripts/prod/stop_prod_env.sh

./scripts/prod/start_prod_env.sh
./scripts/prod/restart_prod_env.sh
./scripts/prod/stop_prod_env.sh
```

建议在 `python_sdk/.env.prod` 中配置：

- `ENVIRONMENT=prod`
- `STORAGE_BACKEND=postgres`
- `POSTGRES_DSN=postgresql://<user>:<password>@<host>:5432/synapse_gateway`
- `POSTGRES_PASSWORD=<password>`（可选；若设置，会覆盖 `POSTGRES_DSN` 里的密码段）
- `REDIS_URL=redis://<host>:6379/0`（可选）
- `REDIS_PASSWORD=<password>`（可选；若设置，会注入/覆盖 `REDIS_URL` 的密码段）

配置优先级说明：

1. PostgreSQL：优先读取 `POSTGRES_DSN`；若同时设置 `POSTGRES_PASSWORD`，会以该密码覆盖 DSN 内密码。
2. Redis：优先读取 `REDIS_URL`；支持 `localhost:6379` 无 scheme 写法，运行时会自动标准化为 `redis://...`。
3. 若未提供 URL，也可通过分字段方式拼接：
  - Postgres: `POSTGRES_HOST/POSTGRES_PORT/POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB`
  - Redis: `REDIS_HOST/REDIS_PORT/REDIS_DB/REDIS_USERNAME/REDIS_PASSWORD`

## 3. 进行端到端 (E2E) 调用测试

在集群成功运行后，按下面步骤完成“充值确认入账 + V2 调用验证”。

### 3.0 账户预充值（可选但推荐）
在执行 E2E 支付前，可先用脚本给测试账户补充 `ETH`（Gas）和 `USDC`（支付代币）。

两份脚本都会读取：
- `scripts/test_accounts.json`（目标测试账户列表）

#### 3.0.1 给测试账户充值 ETH（Gas）
```bash
npx hardhat run scripts/fund.js --network localhost
```

脚本行为：
- 使用 Hardhat 本地第一个 signer 作为转出账户
- 向 `test_accounts.json` 中每个地址发送 `10 ETH`
- 打印每个账户充值后的 ETH 余额

#### 3.0.2 给测试账户充值 USDC（支付代币）
```bash
npx hardhat run scripts/fund_usdc.js --network localhost
```

脚本行为：
- 自动读取 `frontend/src/contract-config.json` 中的 `MockUSDC` 地址
- 向 `test_accounts.json` 中每个地址发放 `1000 USDC`
- 优先尝试 `transfer`，失败时自动回退到 `mint`
- 打印每个账户充值后的 USDC 余额

> 提示：若您重启了 Hardhat 节点并重新部署合约，建议先执行一次 `fund.js` 和 `fund_usdc.js` 再跑 E2E。

### 3.1 生成一笔链上交易，拿到 `TX_HASH`
在项目根目录另开终端：
```bash
npx hardhat run scripts/e2e_sync_payment.js --network localhost
```

运行后会输出：
- `SERVICE_ID=SVC_DEMO`
- `TX_HASH=0x...`

### 3.2 提交充值 intent（等待 Indexer 入账）

```bash
curl -X POST http://127.0.0.1:8000/api/v1/balance/deposit/intent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "X-User-Address: <owner_wallet>" \
  -d '{"txHash":"<TX_HASH>","amountUsdc":1}'
```

可通过以下接口查询入账状态：

```bash
curl -X GET "http://127.0.0.1:8000/api/v1/balance/deposit/intents?limit=20" \
  -H "Authorization: Bearer <token>" \
  -H "X-User-Address: <owner_wallet>"
```

### 3.3 调用 V2 Generate

```bash
curl -X POST http://127.0.0.1:8000/api/v1/gateway/generate \
	-H "Content-Type: application/json" \
	-H "X-Agent-Credential: <X-Agent-Credential>" \
  -H "X-Service-Id: SVC_DEMO" \
  -d '{"prompt":"hello provider","service_id":"SVC_DEMO"}'
```

成功时返回 `{"status":"success", ...}`。

### 测试中，您将观察到的完美流转日志链：
1. **-> Approving tokens...** (买家先将需要支付的 `USDC` 授权给以太坊路由合约)
2. **-> Paying via router...** (调用 `payForService` 进行平台抽水和对 Seller 资金的拆分)
3. **-> Waiting for tx: 0x...** (捕获充值交易哈希)
4. **-> Submitting deposit intent...** (通知网关等待链上确认并入账)
5. **-> Sending API request with Credential...** (凭据 + serviceId 发起 V2 调用)
6. **[Success] Received AI Data** (网关完成凭据校验、余额扣减和审计后返回结果)

*容错闭环:* 若对方 API Timeout 宕机或者拿钱不发货反馈 HTTP 500，脚本将展示信任降级策略：`ACTION: Blacklisting Seller locally`。

## 4. 手动分步开发启动流 (高级)

如果您在研发过程中需要单独对某单一组件进行调试或重启：

### 4.1 安装启动 Anvil 模拟链与部署智能合约 (V2)

随着 V2 架构引入 ERC-2612 Permit 和更高级的智能合约，我们建议使用 Anvil（Foundry）作为本地模拟链以获得无缝的高速体验。

**第一步：安装 Anvil (Foundry)**
如果您还未安装 Foundry 工具链，可以执行以下命令一键安装：
```bash
curl -L https://foundry.paradigm.xyz | bash
# 安装完毕后，根据提示在终端更新工具链
foundryup
```

**第二步：启动 Anvil 本地链**
在项目根目录新开一个终端窗口，启动 Anvil：
```bash
anvil
```
*(Anvil 会在 `127.0.0.1:8545` 启动一个极速版的本地以太坊节点，并提供 10 个测试账号)*

**第三步：部署 V2 SynapseCore 智能合约**
请切记，每次重启 Anvil 节点后，都需要重新部署合约。在项目根目录另开一个终端：
```bash
npx hardhat run scripts/deploy_anvil.js --network localhost
```
*(脚本会自动部署支持 `ERC20Permit` 的 `MockUSDC` 与 `SynapseCore`，并将新地址自动写入 `frontend/src/contract-config.json` 中)*

### 4.2 开发模式下启动 Seller FastAPI
此命令会基于 `uvicorn` 热重载模式启动 API，当您修改相关的 Python 校验代码时自动生效：
```bash
cd python_sdk
python3 seller_fastapi.py
```

如需手动指定链上校验参数：
```bash
RPC_URL=http://127.0.0.1:8545 \
ROUTER_ADDRESS=<router_address> \
SELLER_ADDRESS=<seller_address> \
EXPECTED_PRICE=1000000000000000000 \
python3 seller_fastapi.py
```

## 5. 本地基础设施组件维护 (docker-compose)
如果将来的实际 AI Agent 计算结果极大（如高清图像渲染图，几十兆语义视频等），请勿将其塞入纯文本响应。可搭配本地 MinIO（S3）服务进行地址链接流转。

### 5.1 前置条件

请确保机器已安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，并可使用 `docker-compose`（V2）命令。

进入 compose 目录：

```bash
cd docker-compose
```

### 5.2 启动（首次或冷启动）

```bash
docker-compose up -d
```

说明：该命令会按 `docker-compose.yml` 启动 `postgres`、`minio`、`otterscan`。

### 5.3 重启（推荐运维操作）

重启全部服务：

```bash
docker-compose restart
```

仅重启单服务（示例）：

```bash
docker-compose restart postgres
docker-compose restart minio
docker-compose restart otterscan
```

若希望重建容器并刷新运行参数（不删卷）：

```bash
docker-compose up -d --force-recreate
```

### 5.4 停止与下线

停止服务但保留网络与卷：

```bash
docker-compose stop
```

下线并删除容器与网络（保留卷）：

```bash
docker-compose down
```

下线并删除卷（会清空 Postgres/MinIO 本地数据，谨慎执行）：

```bash
docker-compose down -v
```

### 5.5 状态与日志排障

查看状态：

```bash
docker-compose ps
```

查看最近日志：

```bash
docker-compose logs --tail=200
```

持续跟踪日志（示例）：

```bash
docker-compose logs -f postgres
docker-compose logs -f minio
```

重新创建并且导入sql
```bash
cd /Users/cliff/workspace/Synapse-Network/docker-compose
docker-compose down postgres -v
docker-compose up -d postgres
docker-compose logs -f postgres
```

### 5.6 访问地址

- MinIO Console: `http://127.0.0.1:9001`
- MinIO API: `http://127.0.0.1:9000`
- PostgreSQL: `127.0.0.1:5432`
- Otterscan: `http://127.0.0.1:5100`

备注：若本地是旧版 Compose，也可将 `docker-compose` 替换为 `docker-compose` 执行同等命令。

## 6. `python_sdk` 配置文件位置与统一收口方案

### 6.1 当前配置文件在哪里（现状盘点）

当前 `python_sdk` 中存在多处配置入口：

- `python_sdk/.env`
  - 主要是 SDK / AI Agent Demo 侧配置（如 `API_BASE_URL`、`DEEPSEEK_*`、`MINIO_*`）。
- `python_sdk/seller_api/src/core/config.py`
  - **当前 FastAPI 网关主配置入口**（被 `src/app.py` 直接使用）。
  - 包含：`RPC_URL`、`ROUTER_ADDRESS`、`JWT_SECRET`、`HOST`、`PORT`、`POSTGRES_*`、`REDIS_*` 等。
- `python_sdk/seller_api/settings.py`
  - 历史兼容配置模块，仍被部分 legacy 代码（如 `persistence.py`）引用。
  - 与 `src/core/config.py` 存在字段重复。
- `python_sdk/config.py`
  - 旧静态配置文件（例如固定 `RPC_URL`），不建议作为新逻辑入口。

结论：目前是“主入口 + 兼容入口 + 遗留入口”并存，存在配置分散与重复定义风险。

### 6.2 统一收口目标（目标架构）

统一为**单一配置中心**：

- 唯一读取入口：`python_sdk/seller_api/src/core/config.py`
- 唯一环境文件：`python_sdk/.env`（按环境可扩展 `.env.development` / `.env.staging` / `.env.production`）
- 唯一运行时工件根：`python_sdk/runtime_storage/`

约束原则：

- 所有业务代码禁止直接 `os.getenv(...)` 取值（仅 `src/core/config.py` 可读取环境变量）。
- 路由层、服务层、存储层只依赖 `settings` 对象，不感知环境变量细节。
- 路径、密钥、限流、链上参数分组管理，避免“散点配置”。

### 6.3 推荐配置分层（建议）

在 `src/core/config.py` 内按 Domain 分组：

- `AppSettings`：`environment/host/port`
- `ChainSettings`：`rpc_url/router_address/v2_deposit_confirmations`
- `AuthSettings`：`jwt_secret/auth_ttl/challenge_ttl`
- `StorageSettings`：`storage_backend/postgres_*`
- `RateLimitSettings`：`owner_rpm/agent_rpm/service_rpm/window_sec`
- `BillingSettings`：`platform_fee_rate`（全局默认手续费率）
- `FeatureFlags`：兼容开关、灰度开关

最终对外暴露一个聚合对象：`settings`。

计费配置补充（当前实现）：

- 全局费率：`PLATFORM_FEE_RATE`（范围 `0.0 ~ 1.0`，默认 `0.10`）。
- 运行时覆盖（预留给管理后台）：`platform_fee_policy` 存储集合。
  - `defaultRate`: 运行时默认费率（可覆盖全局配置）。
  - `ownerRates`: 按卖家钱包地址覆盖费率，键为 `ownerAddress`。

生效优先级：`ownerRates[ownerAddress] > platform_fee_policy.defaultRate > PLATFORM_FEE_RATE`。

补充说明（Auth 生命周期设计）：

- challenge/session 的边界、TTL 推荐值与用户体验策略，见：
  - `doc/feature_designs/frontend_product/Wallet_Auth_Challenge_Session_Design.md`

### 6.4 收口迁移步骤（可执行）

1. **冻结新增配置入口**
   - 新增参数只允许进入 `src/core/config.py`。

2. **建立兼容桥接层**
   - 在 `seller_api/settings.py` 保留最薄兼容壳：
   - 仅 `from src.core.config import settings`，并导出必要兼容别名。

3. **逐步替换 legacy 引用**
   - 将 `persistence.py` 等 legacy 模块对 `seller_api/settings.py` 的依赖迁移到 `src/core/config.py`。

4. **移除重复字段与死配置**
   - 清理 `python_sdk/config.py` 与 `seller_api/settings.py` 中重复且不再被调用字段。

5. **配置契约化**
   - 维护 `python_sdk/.env.example` 作为唯一配置契约文档。
   - CI 增加“必填配置校验”与“未使用配置检测”。

### 6.5 命名规范（建议）

- 统一前缀：
  - 网关后端：`SYNAPSE_GATEWAY_*`
  - SDK/客户端：`SYNAPSE_CLIENT_*`
  - 链上参数：`SYNAPSE_CHAIN_*`
- 避免混用历史变量名（例如同义 `AUTH_SECRET` / `JWT_SECRET` 并存）。

### 6.6 配置收口完成标准（Done Definition）

- 代码库中除 `src/core/config.py` 外，不再出现新增 `os.getenv(...)`。
- `seller_api/settings.py` 仅保留兼容导出，不再承载独立配置逻辑。
- 文档、`.env.example`、运行行为三者一致。
- 本地与 CI 能通过同一套配置启动流程。
