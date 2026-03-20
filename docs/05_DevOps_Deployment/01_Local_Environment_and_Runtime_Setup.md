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
2. `gateway/.env.prod.example` 用于生产部署模板
3. `gateway/.env.example` 是完整变量总表

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