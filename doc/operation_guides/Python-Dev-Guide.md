# A2A-Pay Python 后端与 SDK 运维启动指南 (Operation Guide)

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

为简化启动流程，我们在根目录提供了 `setup_local_env.sh` 脚本。它将一键完成：
- 启动 **Hardhat 本地链** (`127.0.0.1:8545`)
- 部署 **A2APaySyncRouter + MockUSDC**
- 自动读取 `frontend/src/contract-config.json` 并注入 Seller API 所需环境变量
- 自动优先使用 `python_sdk/venv/bin/python`（若存在），并在缺依赖时自动安装 `python_sdk/requirements.txt`
- 后台启动 `python_sdk/seller_fastapi.py`
- 后台启动 `frontend`（`npm run dev`）

请在**项目根目录**（A2A-pay）打开一个新的终端窗口并执行：
```bash
chmod +x test/setup_local_env.sh
./test/setup_local_env.sh
```

**运行成功后，系统将自动就绪：**
* **Hardhat Node** 正在本地 `127.0.0.1:8545` 运行并产出区块。
* **部署逻辑** 已自动将新的合约 ABI 生成到 `python_sdk/A2APaySyncRouterABI.json` 以供后端中间件调用。
* **Seller API Gateway** (带有支付验证的中间件服务) 运行在 `http://127.0.0.1:8000/api/v1/generate`。
* **Frontend Next.js** 运行在 `http://127.0.0.1:3000`。
* 脚本会输出 `TX_HASH` 测试前置脚本命令，以及本次启动的 PID。

要停止测试集群，可以使用日志中打印出的 PIDs 进行 `kill`，或直接关闭发起脚本的终端进程。

推荐使用一键停止脚本：
```bash
chmod +x test/stop_local_env.sh
./test/stop_local_env.sh
```

如需“一键重启”（先停再起）：
```bash
chmod +x test/restart_local_env.sh
./test/restart_local_env.sh
```

## 3. 进行端到端 (E2E) 调用测试

在集群成功运行后，按下面两步完成真实链上支付 + FastAPI 验证。

### 3.1 生成一笔链上支付，拿到 `TX_HASH`
在项目根目录另开终端：
```bash
npx hardhat run scripts/e2e_sync_payment.js --network localhost
```

运行后会输出：
- `SERVICE_ID=V1_DEMO`
- `TX_HASH=0x...`

### 3.2 用该 `TX_HASH` 调用 Seller API
```bash
curl -X POST http://127.0.0.1:8000/api/v1/generate \
	-H "Content-Type: application/json" \
	-H "X-Tx-Hash: <替换为上一步输出的TX_HASH>" \
	-d '{"prompt":"hello provider","service_id":"V1_DEMO"}'
```

成功时返回 `{"status":"success", ...}`。

### 测试中，您将观察到的完美流转日志链：
1. **-> Approving tokens...** (买家先将需要支付的 `USDC` 授权给以太坊路由合约)
2. **-> Paying via router...** (调用 `payForService` 进行平台抽水和对 Seller 资金的拆分)
3. **-> Waiting for tx: 0x...** (捕获付款哈希 TxHash 存证)
4. **-> Sending API request with TxHash...** (向接口发起 HTTP POST，通过 `X-Tx-Hash` 注入前置支付凭证)
5. **[Success] Received AI Data** (Seller 服务端查验哈希通过，验证金额、接收方、service_id 且无重放后返回结果)

*容错闭环:* 若对方 API Timeout 宕机或者拿钱不发货反馈 HTTP 500，脚本将展示信任降级策略：`ACTION: Blacklisting Seller locally`。

## 4. 手动分步开发启动流 (高级)

如果您在研发过程中需要单独对某单一组件进行调试或重启：

### 4.1 重启链与智能合约
```bash
# 根目录打开终端运行区块链
npx hardhat node

# 另开终端运行部署层逻辑（请切记每次 Hardhat Node 重启都要重新 deploy）
npx hardhat run scripts/deploy.js --network localhost
```

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

## 5. 本地对象存储 OSS 流转 (可选)
如果将来的实际 AI Agent 计算结果极大（如高清图像渲染图，几十兆的语意视频等），请勿将其塞入纯文本响应。您可以搭配本地 MinIO（S3）服务进行地址链接的流转：
```bash
# 在 A2A-pay 根目录下执行
docker-compose up -d
```
界面控制台位于 `http://127.0.0.1:9001` (账号密码: admin/password)。此时您可以由 Seller 端先把文件传入 MinIO，再将生成的 `Download URL` 作为 FastAPI 的最后返回值下发给买方客户端，达成全链路离链分发。