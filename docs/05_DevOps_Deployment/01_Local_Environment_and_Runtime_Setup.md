# Local Environment and Runtime Setup

## 1. 目标

本文件定义 Synapse 在本地开发、联调和最小集成环境中的推荐启动方式。

目标不是给开发者几十条脚本，而是让本地环境围绕真实主链路建立：

1. Owner 入金
2. Agent discover / quote / invoke
3. Gateway 原子结算
4. Provider 收益累积
5. 索引器确认账本状态

## 2. 本地组件最小集合

开发环境至少需要：

1. PostgreSQL
2. 可选 Redis
3. 本地链或测试链 RPC
4. Platform Gateway
5. Frontend Console
6. 可选 Provider endpoint

如果要调试后台治理，再追加：

1. gateway-admin backend
2. admin-front

## 3. 推荐启动路径

### 3.1 一键本地环境

推荐从仓库根目录执行本地环境脚本。

这条路径的目标是一次性完成：

1. 启动本地依赖
2. 部署或连接本地合约环境
3. 启动 Gateway
4. 启动前端控制台

推荐命令：

```bash
cd /Users/cliff/workspace/Synapse-Network
bash scripts/local/setup_local_env.sh
```

这条命令会串起下面几步真实动作：

1. 启动或复用 `anvil` 本地 RPC（默认 `127.0.0.1:8545`）
2. 执行 `scripts/deploy_anvil.js` 部署 `MockUSDC` 和 `SynapseCore`
3. 执行 `scripts/fund_eth.js` 给测试钱包补 ETH
4. 执行 `scripts/fund_usdc.js` 给测试钱包补 MockUSDC
5. 启动 `gateway/gateway_fastapi.py`
6. 启动 `apps/frontend` 开发服务器

关键纪律：

1. `scripts/*.js` 里的合约脚本不是 shell 脚本，不能用 `sh scripts/fund_eth.js` 执行。
2. 这类脚本必须通过 Hardhat Runtime 执行，统一命令格式是 `npx hardhat run scripts/<name>.js --network <network>`。
3. `scripts/local/*.sh`、`scripts/prod/*.sh` 才是 shell 运维脚本，使用 `bash` 执行。

### 3.2 单独调试 Gateway

单独调试 Gateway 时，应保证以下依赖先可用：

1. `POSTGRES_DSN`
2. `RPC_URL`
3. `ROUTER_ADDRESS`
4. `USDC_TOKEN_ADDRESS`
5. 身份和会话密钥

然后再单独启动 Gateway 进程。

### 3.3 本地链调试

本地链的目的不是“模拟整个生产世界”，而是用于：

1. Deposit 事件验证
2. Withdraw 签名链路验证
3. Indexer / backfill / reconciliation 行为调试

如果要做区块浏览和链上调试，推荐使用支持本地扩展 RPC 的链节点与浏览器组合，而不是把 Hardhat 节点当成长期运维工具。

### 3.3.1 scripts/fund_eth.js 如何执行

这个脚本的作用非常直接：

1. 从当前 Hardhat/Anvil 的第一个 signer 出账
2. 给一组测试地址各转入 `10 ETH`
3. 转账完成后打印每个地址的新 ETH 余额

正确执行方式：

```bash
cd /Users/cliff/workspace/Synapse-Network
npx hardhat run scripts/fund_eth.js --network localhost
```

不要这样执行：

```bash
sh scripts/fund_eth.js
```

原因：

1. `fund_eth.js` 是 Node/Hardhat 脚本，不是 shell 脚本。
2. 用 `sh` 执行会把 JavaScript 当成 shell 语法解释，直接失败。

地址来源有两种：

1. 不传地址：脚本会读取 `scripts/test_eth_accounts.json`
2. 传入地址：脚本会优先使用命令行中的 `0x...` 地址参数

示例 1，使用扫描好的测试账户配置：

```bash
cd /Users/cliff/workspace/Synapse-Network
npx hardhat run scripts/fund_eth.js --network localhost
```

示例 2，只给指定地址充值：

```bash
cd /Users/cliff/workspace/Synapse-Network
npx hardhat run scripts/fund_eth.js --network localhost -- \
	0x1111111111111111111111111111111111111111 \
	0x2222222222222222222222222222222222222222
```

推荐前置步骤：

```bash
cd /Users/cliff/workspace/Synapse-Network
npx hardhat run scripts/scan_accounts.js --network localhost
npx hardhat run scripts/fund_eth.js --network localhost
```

适用场景：

1. 新起一套本地 Anvil 后，测试钱包没有 gas
2. 前端切钱包后无法发起 deposit / claim / approve
3. 需要给新加入的测试地址补原生币做联调
4. Provider 在 Settlement 页面执行 Claim / Withdraw 时，钱包会自己支付链上 gas；没有原生币时，前端会在提现前直接拦截并提示先补 gas
5. Provider Claim / Withdraw 现在会在“创建提现意图 / 锁定 Pending / Locked”之前先检查 vault 链上 USDC 流动性；如果金库余额不足，前后端都会直接拒绝，不会再先锁账再报错
6. 如果提现意图已经进入 `Pending / Locked`，但链上 claim 一直没有成功，系统会在 ticket 过期后自动释放回 `Available`；当前默认配置下，用户侧看到的大致释放时间约为 6 分钟

### 3.3.2 scripts/fund_usdc.js 如何执行

作用：

1. 读取 `apps/frontend/src/contract-config.json` 中的 `MockUSDC` 地址
2. 给一组测试账户各补 `1000 MockUSDC`
3. 如果 `transfer` 失败，则回退尝试 `mint`
4. 打印每个目标地址当前 USDC 余额

执行方式：

```bash
cd /Users/cliff/workspace/Synapse-Network
npx hardhat run scripts/fund_usdc.js --network localhost
```

指定地址：

```bash
cd /Users/cliff/workspace/Synapse-Network
npx hardhat run scripts/fund_usdc.js --network localhost -- \
	0x1111111111111111111111111111111111111111
```

注意：

1. 这个脚本依赖 `contract-config.json` 已经存在且包含 `MockUSDC`
2. 因此通常要先执行 `scripts/deploy_anvil.js` 或 `scripts/local/setup_local_env.sh`

### 3.3.3 scripts/ 目录脚本索引

仓库根目录 `scripts/` 不是一堆散弹文件，而是 6 类能力：

1. 合约部署与本地链资金脚本
2. 本地环境拉起/停止脚本
3. 生产 profile 启停脚本
4. Python 运行时解析脚本
5. CI 质量门禁脚本
6. 一次性辅助脚本与 SQL 修复脚本

#### A. 合约部署与资金脚本

`scripts/deploy_anvil.js`

1. 用途：在本地链部署 `MockUSDC` 与 `SynapseCore`
2. 输出：更新 `apps/frontend/src/contract-config.json`
3. 用法：`npx hardhat run scripts/deploy_anvil.js --network localhost`

`scripts/scan_accounts.js`

1. 用途：扫描当前 Hardhat signer，并生成 `scripts/test_eth_accounts.json` 与 `scripts/test_usdc_accounts.json`
2. 默认写入 3 个角色：`Platform`、`ownerAgent`、`providerAgent`
3. 用法：`npx hardhat run scripts/scan_accounts.js --network localhost`

`scripts/fund_eth.js`

1. 用途：给测试地址补原生 ETH，默认每个地址 `10 ETH`
2. 地址来源：CLI 地址参数，或 `scripts/test_eth_accounts.json`
3. 用法：`npx hardhat run scripts/fund_eth.js --network localhost -- <addr1> <addr2>`

`scripts/fund_usdc.js`

1. 用途：给测试地址补 MockUSDC，默认每个地址 `1000 USDC`
2. 地址来源：CLI 地址参数，或 `scripts/test_usdc_accounts.json`
3. 用法：`npx hardhat run scripts/fund_usdc.js --network localhost -- <addr1> <addr2>`

`scripts/e2e_sync_payment.js`

1. 用途：做一次最小链上同步支付演练，顺序包括 `mint -> approve -> payForService`
2. 依赖：`contract-config.json`、`SynapseCoreABI.json`、`MockUSDCABI.json`
3. 用法：`npx hardhat run scripts/e2e_sync_payment.js --network localhost`

#### B. 合约状态检查脚本

`scripts/check_balance.js`

1. 用途：检查固定地址的 MockUSDC 余额
2. 依赖：`apps/frontend/src/contract-config.json`
3. 用法：`npx hardhat run scripts/check_balance.js --network localhost`

`scripts/check-allowance.js`

1. 用途：检查指定钱包对 Router 的 USDC allowance 和余额
2. 当前脚本内置了 Router 地址和两个待扫描钱包，适合本地排查，不适合作为通用生产工具
3. 用法：`npx hardhat run scripts/check-allowance.js --network localhost`

`scripts/check_decimals.js`

1. 用途：检查当前 MockUSDC 的 decimals 设置
2. 适合排查金额换算和 ABI/部署错配问题
3. 用法：`npx hardhat run scripts/check_decimals.js --network localhost`

#### C. 本地环境脚本

`scripts/local/setup_local_env.sh`

1. 用途：一键启动本地链、部署合约、补 ETH/USDC、启动 gateway 与前端
2. 用法：`./scripts/local/setup_local_env.sh` 或 `bash scripts/local/setup_local_env.sh`

`scripts/local/stop_local_env.sh`

1. 用途：基于 `.local_env.pids` 或端口扫描，停止本地 Anvil、gateway、frontend
2. 用法：`./scripts/local/stop_local_env.sh` 或 `bash scripts/local/stop_local_env.sh`

`scripts/local/restart_local_env.sh`

1. 用途：先停再起整套本地环境
2. 默认跳过 V2 smoke；设置 `SKIP_V2_SMOKE=0` 时会额外跑 `gateway/examples/v2_daily_limit_regression.py`
3. 用法：`./scripts/local/restart_local_env.sh` 或 `bash scripts/local/restart_local_env.sh`

`scripts/local/restart_gateway.sh`

1. 用途：只重启 `gateway/gateway_fastapi.py`，不重启前端和 Anvil
2. 适合改了 Gateway 代码或 `.env.local` 之后快速重载
3. 用法：`./scripts/local/restart_gateway.sh` 或 `bash scripts/local/restart_gateway.sh`
4. 如果手滑用了 `sh scripts/local/*.sh`，脚本现在会自动重新切回 `bash`，避免 `pipefail` 兼容性错误。

#### D. 共享测试网 / 生产 profile 脚本

`scripts/staging/start_staging_env.sh`

1. 用途：按 `staging` profile 启动 `gateway/provider_fastapi.py`
2. 优先读取 `gateway/.env.staging`
3. 用法：`bash scripts/staging/start_staging_env.sh`

`scripts/staging/stop_staging_env.sh`

1. 用途：停止 staging profile 的 Gateway 进程
2. 用法：`bash scripts/staging/stop_staging_env.sh`

`scripts/staging/restart_staging_env.sh`

1. 用途：先停后起 staging profile
2. 用法：`bash scripts/staging/restart_staging_env.sh`

`scripts/prod/start_prod_env.sh`

1. 用途：按 `prod` profile 启动 `gateway/provider_fastapi.py`
2. 优先读取 `gateway/.env.prod`
3. 用法：`bash scripts/prod/start_prod_env.sh`

`scripts/prod/stop_prod_env.sh`

1. 用途：停止 prod profile 的 Gateway 进程
2. 用法：`bash scripts/prod/stop_prod_env.sh`

`scripts/prod/restart_prod_env.sh`

1. 用途：先停后起 prod profile
2. 用法：`bash scripts/prod/restart_prod_env.sh`

#### E. Python 辅助脚本

`scripts/python/resolve_python_311.sh`

1. 用途：解析仓库要求的 Python 3.11 解释器
2. 优先级：`SYNAPSE_PYTHON_BIN` -> `python3.11` -> 常见安装路径 -> pyenv shim
3. 用法：`bash scripts/python/resolve_python_311.sh`

`scripts/generate_jwt_secret.py`

1. 用途：生成 `.env` 可直接使用的高强度随机 secret
2. 默认输出：`JWT_SECRET=<random>`
3. 用法：`python scripts/generate_jwt_secret.py --length 48 --name AUTH_SECRET`

#### F. 质量门禁与一次性辅助脚本

`scripts/ci/`

1. 用途：按模块执行 CI 质量门禁，例如 frontend、gateway、admin、sdk-python
2. 典型入口：`bash scripts/ci/pr_checks.sh`

`scripts/sql/cleanup_synapse_audit_events_20260318.sql`

1. 用途：一次性 SQL 清理脚本
2. 原则：只能在明确审批与备份前提下执行，不能把这类脚本当日常运维命令

`scripts/fix-react-file.js`

1. 用途：一次性写入历史 React 页面文件的修复脚本
2. 这是临时辅助脚本，不属于常规运维路径
3. 不建议在当前主流程中继续复用

### 3.4 Python 环境策略

本仓库存在多个 Python 子项目：

1. `gateway/`
2. `admin/gateway-admin/`
3. `provider_service/`
4. `sdk/python/`

这四者不应共享同一个虚拟环境。

本地开发应统一的是 Python 主版本基线和命令格式，而不是把所有依赖塞进一个 `.venv`。

推荐规则：

1. 每个目录维护自己的 `.venv`
2. 服务类目录用 `requirements.txt` 安装依赖
3. `sdk/python` 用 `pip install -e .` 安装并在自己的环境里执行测试和构建
4. 不再把 `admin/gateway-admin/.venv` 当作 SDK 的默认解释器

详细设计见：`06_Python_Environment_and_Venv_Strategy.md`

## 4. 环境变量分层

### 4.1 必填基础项

Gateway 至少要显式配置：

1. `ENVIRONMENT`
2. `RPC_URL`
3. `PRIVATE_KEY`（如果要启用 Provider 提现，则这是硬门槛）
4. `ROUTER_ADDRESS`
5. `USDC_TOKEN_ADDRESS`
6. `POSTGRES_DSN`
7. `JWT_SECRET`
8. `AUTH_SECRET`

模板位置：

1. `gateway/.env.local.example` 用于本地开发
2. `gateway/.env.staging.example` 用于共享测试网 / 演示环境
3. `gateway/.env.prod.example` 用于生产部署模板
4. `gateway/.env.example` 是完整变量总表

`PRIVATE_KEY` 的语义必须明确：

1. 它是 Gateway withdraw signer，用于签发 EIP-712 withdrawal ticket。
2. 它不是浏览器钱包助记词，也不是 Provider 自己在前端连接的钱包私钥。
3. 没有它时，Provider Settlements 只能看到提现能力不可用，不能签发 `Generate & Claim`。

推荐来源：

1. 本地开发：使用 Anvil / Hardhat 启动后打印的测试账户私钥，或单独创建一个本地测试账户。
2. 生产环境：使用独立签名账户，并通过 Secret Manager / KMS / HSM 或部署平台环境变量注入。
3. 严禁把真实生产私钥提交到仓库，或复用个人主钱包助记词。

### 4.2 金融与幂等参数

必须可配置：

1. `FINANCE_IDEMPOTENCY_TTL_SEC`
2. `FINANCE_IDEMPOTENCY_MAX_ROWS`
3. `FINANCE_REPLAY_WINDOW_SEC`
4. `FINANCE_WRITE_RATE_LIMIT_PER_MIN`

### 4.3 提现风控参数

必须可配置：

1. `WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC`
2. `WITHDRAWAL_AUTO_24H_LIMIT_USDC`
3. `WITHDRAWAL_WINDOW_HOURS`
4. `WITHDRAWAL_HIGH_RISK_PROVIDER_ADDRESSES`
5. `PROVIDER_WITHDRAW_DEADLINE_SEC`
6. `PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED`
7. `PROVIDER_WITHDRAW_EXPIRY_REAPER_INTERVAL_SEC`

说明：

1. `PROVIDER_WITHDRAW_DEADLINE_SEC` 控制 EIP-712 withdrawal ticket 的有效期；当前默认值是 `300` 秒。
2. `PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED=true` 时，Gateway 会启动后台定时任务扫描过期 Provider ticket。
3. `PROVIDER_WITHDRAW_EXPIRY_REAPER_INTERVAL_SEC` 控制定时扫描间隔；当前默认值是 `30` 秒，默认是短周期守护，而不是依赖用户刷新页面后才释放 locked 金额。
4. 因此在默认配置下，Provider 侧看到的 `Pending / Locked` 自动释放时间通常约为 5 分钟票据有效期加上下一轮扫描延迟，也就是大约 6 分钟。

### 4.4 索引器与对账参数

必须可配置：

1. `V2_INDEXER_POLL_INTERVAL_SEC`
2. `V2_BACKFILL_BLOCK_BATCH`
3. `V2_RECONCILIATION_INTERVAL_SEC`
4. `V2_RECONCILIATION_ALERT_DELTA_USDC`

## 5. 本地开发纪律

### 5.1 先保证数据库是事实源

无论本地是否启用 Redis，最终真相都必须落到 PostgreSQL。

### 5.2 不允许手工改余额冒充调试

本地调试入金、退款、提现、扣费时，也应尽量走：

1. deposit intent
2. chain event / replay
3. quote / invoke
4. withdrawal intent

而不是直接手工改余额字段。

### 5.3 入口文件名不代表产品模型

即使某些历史入口文件仍保留旧命名，也不能把文件名反向当作当前角色模型和系统边界。

### 5.4 环境边界要和交付边界一致

如果一个目录是独立运行、独立测试、独立发布的单元，那么它就必须有独立的 Python 虚拟环境。

否则本地环境虽然“能跑”，但 CI、发布和生产问题会一起变得不可复现。

## 6. 文档结论

本地环境的正确目标不是“把页面点开”，而是尽可能在本地还原 Synapse 的真实执行链：

**Vault Funding -> Indexer Confirmation -> Agent Invocation -> Gateway Settlement -> Provider Receivable**

只有这样，本地联调才对生产有价值。
