# 目录结构 v2 — 生产级重设计

**决策日期**: 2026-04-03  
**状态**: 已实施  
**作者**: CTO / AI Agent

---

## 一、重设计动机

| 问题 | 旧状态 | 影响 |
|------|--------|------|
| 服务位置混乱 | `gateway/` 在根目录，`admin/gateway-admin/` 嵌套一层，`apps/frontend/` 有无意义的 apps 包装层 | 新人上手成本高，CI 路径依赖混乱 |
| admin/ 混用两种技术栈 | Python FastAPI + Next.js 打包在同一个 `admin/` | 无隔离意义，IDE 索引混乱 |
| Hardhat 工具链污染根目录 | `hardhat.config.js`、`artifacts/`、`cache/` 散落在根 | 根目录不干净，`.gitignore` 复杂 |
| 基础设施路径硬编码 | `docker-compose/` 只有单层，脚本依赖硬编码且无环境分层 | 多环境部署困难 |
| docs/ 命名不一致 | 有序号目录 (`01_Product_Vision`) 又有平铺目录 (`admin`, `bugfix`, `exec-plans`)，无统一约定 | AI agent 无法快速定位文档 |
| 根目录运行时垃圾 | `logs/`、`output/`、`anvil_node.log` 是运行时产物 | 根目录噪音，干扰代码索引 |

---

## 二、设计原则

1. **服务隔离 (Service Isolation)**: 每个可独立部署的 Service 在 `services/` 下有独立目录，自带 `Dockerfile`、`requirements.txt` / `package.json`、`.env.*.example`、`tests/`
2. **链上工程分层 (Chain Tooling)**: Hardhat 相关链上脚本收到 `scripts/chain/`；合约源码保持在 `contracts/`
3. **基础设施集中 (Infra Centralized)**: `infra/` 统一管理 docker-compose（按环境分层）和 DB init
4. **脚本按用途分组 (Scripts by Purpose)**: `scripts/` 下保留 `local/`、`prod/`、`staging/`、`ci/`，新增 `chain/`（链上 JS）和 `ops/`（运维工具）
5. **文档统一归并 (Docs Normalized)**: 平铺杂项目录合并进已有编号目录，消除根层面的散落目录

---

## 三、目标目录结构

```
Synapse-Network/
│
├── services/                            # ← 所有可独立部署的 4 个服务
│   ├── gateway/                         # 核心计费网关 (Python FastAPI, :8000)
│   │   ├── src/
│   │   │   ├── api/routers/             # balance, forwarding, registry, auth...
│   │   │   ├── core/                    # config, redis, cors, log_config
│   │   │   ├── domain/                  # finance, ledger, execution, voucher...
│   │   │   ├── services/                # owner/, platform/, provider/
│   │   │   └── storage/postgres/repositories/
│   │   ├── tests/e2e/ + tests/unit/
│   │   ├── Dockerfile
│   │   ├── pytest.ini
│   │   ├── requirements.txt
│   │   ├── .env.*.example
│   │   └── AGENTS.md
│   │
│   ├── gateway-admin/                   # 管控面后端 API (Python FastAPI, :8080)
│   │   ├── src/
│   │   │   ├── api/routers/             # approval, audit, dashboard, users...
│   │   │   ├── core/                    # config, security, totp, csrf
│   │   │   ├── domain/
│   │   │   └── storage/
│   │   ├── tests/
│   │   ├── scripts/                     # admin-specific: migrations, bootstrap
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── .env.*.example
│   │
│   ├── admin-front/                     # 管控面 UI (Next.js, :3001)
│   │   ├── src/
│   │   │   ├── app/                     # approvals, audit, finance, users...
│   │   │   └── components/
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── user-front/                      # 用户侧 Dashboard (Next.js, :3000)
│       ├── src/
│       │   ├── app/                     # dashboard, docs, marketplace, blog...
│       │   └── components/
│       ├── next.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── contracts/                           # 智能合约（Solidity 源码）
│   ├── SynapseCore.sol
│   ├── MockUSDC.sol
│   └── README.md
│
├── infra/                               # 基础设施 — Docker & DB
│   ├── docker/
│   │   ├── local/
│   │   │   └── docker-compose.yml       # postgres:5432, redis, minio (本地)
│   │   ├── staging/
│   │   │   └── docker-compose.yml       # (预留)
│   │   └── prod/
│   │       └── docker-compose.yml       # (预留)
│   └── postgres/
│       └── init/
│           ├── 000_run_init_tree.sh
│           ├── gateway/                 # synapse_gateway + gateway_admin 表初始化
│           └── gateway-admin/
│
├── scripts/                             # 开发者工具 & 运维脚本
│   ├── chain/                           # 链上工具 (ethers.js / Hardhat)
│   │   ├── deploy_anvil.js
│   │   ├── fund_usdc.js
│   │   ├── fund_eth.js
│   │   ├── fund_current_wallet.js
│   │   ├── check-allowance.js
│   │   ├── check_balance.js
│   │   ├── check_decimals.js
│   │   ├── scan_accounts.js
│   │   ├── e2e_sync_payment.js
│   │   ├── test_eth_accounts.json
│   │   └── test_usdc_accounts.json
│   ├── local/                           # 本地开发生命周期
│   │   ├── setup_local_env.sh           # 一键启全栈 (Anvil + gateway + frontend)
│   │   ├── restart_gateway.sh
│   │   ├── restart_local_env.sh
│   │   └── stop_local_env.sh
│   ├── prod/                            # 生产环境运维
│   ├── staging/                         # Staging 环境运维
│   ├── ci/                              # CI pipeline 脚本
│   │   ├── gateway_checks.sh
│   │   ├── admin_gateway_checks.sh
│   │   ├── admin_front_checks.sh
│   │   ├── frontend_checks.sh
│   │   └── validate_docs.js
│   ├── ops/                             # 运维工具（手动操作）
│   │   ├── generate_jwt_secret.py
│   │   └── fix-react-file.js
│   ├── python/                          # Python 工具脚本
│   ├── sql/                             # 一次性 SQL
│   └── ui/                              # UI 测量 / Playwright 脚本
│
├── docs/                                # 项目文档
│   ├── 00_Governance/                   # ADR、变更决策、工作规范
│   │   └── exec-plans/                  # (从 docs/exec-plans/ 合并)
│   ├── 01_Product_Vision/               # 产品愿景、竞品调研
│   │   ├── feature_designs/             # (从 docs/feature_designs/ 合并)
│   │   └── 竞品调研/                    # (从 docs/竞品调研/ 合并)
│   ├── 01_Product_Frontend/             # 前端产品文档 (暂与 Product_Vision 共用 01_)
│   ├── 02_System_Architecture/
│   ├── 03_Core_Workflows/
│   ├── 03_Projects/                     # 各服务项目级文档
│   │   ├── gateway/
│   │   ├── gateway-admin/
│   │   ├── admin-front/
│   │   ├── frontend/                    # user-front 对应文档
│   │   ├── contracts/
│   │   ├── infra/
│   │   └── admin/                       # (从 docs/admin/ 合并)
│   ├── 04_Database_Design/
│   ├── 05_DevOps_Deployment/
│   │   └── directory-structure-v2.md    # ← 本文档
│   ├── 06_Reference/
│   ├── bugfix/
│   ├── AGENTS.md
│   ├── ARCHITECTURE.md
│   └── README.md
│
├── hardhat.config.js                    # Hardhat 配置 (留在根，package.json 同级)
├── package.json                         # 根 package (Hardhat + CI 脚本入口)
├── AGENTS.md
├── README.md
├── CONTRIBUTING.md
├── llms.txt
└── .gitignore                           # 包含: logs/, output/, *.pid, anvil*.log
```

---

## 四、目录变更对照表

| 旧路径 | 新路径 | 原因 |
|--------|--------|------|
| `gateway/` | `services/gateway/` | 统一服务层 |
| `admin/gateway-admin/` | `services/gateway-admin/` | 按服务命名，脱离 admin/ 包装 |
| `admin/admin-front/` | `services/admin-front/` | 技术栈隔离，与 user-front 对称 |
| `apps/frontend/` | `services/user-front/` | 去无意义 apps/ 包装，名字清晰化 |
| `docker-compose/docker-compose.yml` | `infra/docker/local/docker-compose.yml` | infra/ 统一管理，支持多环境分层 |
| `docker-compose/postgres/init/` | `infra/postgres/init/` | 与 docker 配置分离，独立版本化 |
| `scripts/deploy_anvil.js` 等链上 JS | `scripts/chain/` | 按用途分组 |
| `scripts/validate_docs.js` | `scripts/ci/` | 归入 CI 工具 |
| `docs/admin/` | `docs/03_Projects/admin/` | 归入编号体系 |
| `docs/exec-plans/` | `docs/00_Governance/exec-plans/` | 执行计划属于治理层 |
| `docs/feature_designs/` | `docs/01_Product_Vision/feature_designs/` | 功能设计属于产品视野层 |
| `docs/竞品调研/` | `docs/01_Product_Vision/竞品调研/` | 同上 |

---

## 五、暂不迁移的项目（Future Work）

| 项目 | 说明 |
|------|------|
| `hardhat.config.js` → `contracts/hardhat.config.js` | 需配套更新 `artifacts/` 路径、CI 脚本的 `cd` 命令，单独一次迁移 |
| `contracts/` 内部结构（`contracts/contracts/*.sol`） | 同上，Hardhat 默认约定 contracts/ 子目录 |
| `docs/` 编号统一（去除 01_ 重复、全小写） | 涉及文档内链，需扫描后批量替换，单独处理 |

---

## 六、受影响的配置文件

### 6.1 scripts 路径更新

以下脚本中的旧路径已更新：

| 文件 | 旧字符串 | 新字符串 |
|------|---------|---------|
| `scripts/local/restart_gateway.sh` | `${ROOT_DIR}/gateway/` | `${ROOT_DIR}/services/gateway/` |
| `scripts/local/restart_gateway.sh` | `${ROOT_DIR}/apps/frontend/src/` | `${ROOT_DIR}/services/user-front/src/` |
| `scripts/local/setup_local_env.sh` | `${ROOT_DIR}/gateway/` | `${ROOT_DIR}/services/gateway/` |
| `scripts/local/setup_local_env.sh` | `${ROOT_DIR}/apps/frontend/` | `${ROOT_DIR}/services/user-front/` |
| `scripts/local/restart_local_env.sh` | `${ROOT_DIR}/gateway/` | `${ROOT_DIR}/services/gateway/` |
| `scripts/prod/start_prod_env.sh` | `${ROOT_DIR}/gateway/` | `${ROOT_DIR}/services/gateway/` |
| `scripts/staging/start_staging_env.sh` | `${ROOT_DIR}/gateway/` | `${ROOT_DIR}/services/gateway/` |
| `scripts/ci/gateway_checks.sh` | `$ROOT_DIR/gateway` | `$ROOT_DIR/services/gateway` |
| `scripts/ci/admin_gateway_checks.sh` | `$ROOT_DIR/admin/gateway-admin` | `$ROOT_DIR/services/gateway-admin` |
| `scripts/ci/admin_front_checks.sh` | `$ROOT_DIR/admin/admin-front` | `$ROOT_DIR/services/admin-front` |
| `scripts/ci/frontend_checks.sh` | `$ROOT_DIR/apps/frontend` | `$ROOT_DIR/services/user-front` |
| `scripts/chain/deploy_anvil.js` | `apps/frontend/src/contract-config.json` | `services/user-front/src/contract-config.json` |
| `scripts/chain/check_balance.js` | `apps/frontend/src/contract-config.json` | `services/user-front/src/contract-config.json` |
| `scripts/chain/check_decimals.js` | `apps/frontend/src/contract-config.json` | `services/user-front/src/contract-config.json` |
| `scripts/chain/check-allowance.js` | `apps/frontend/src/` | `services/user-front/src/` |
| `scripts/chain/fund_usdc.js` | `apps/frontend/src/contract-config.json` | `services/user-front/src/contract-config.json` |
| `scripts/chain/fund_current_wallet.js` | `apps/frontend/src/contract-config.json` | `services/user-front/src/contract-config.json` |

### 6.2 infra/docker/local/docker-compose.yml

postgres init volume mount 更新：
- 旧: `./postgres/init:/docker-entrypoint-initdb.d:ro`
- 新: `../../postgres/init:/docker-entrypoint-initdb.d:ro`

### 6.3 package.json CI 脚本

`ci:frontend`、`ci:admin-front`、`ci:admin-gateway`、`ci:gateway` 脚本路径通过 shell script 间接引用，已在 shell 脚本中更新，package.json 无需改动。

---

## 七、隔离效果验证

```bash
# 每个 service 可以完全独立验证
cd services/gateway && .venv/bin/pytest tests/ -q
cd services/gateway-admin && .venv/bin/pytest tests/ -q

# 基础设施独立启动
cd infra/docker/local && docker compose up -d

# 链上工具独立运行
node scripts/chain/deploy_anvil.js

# CI 入口不变
npm run ci:gateway
npm run ci:admin-front
```
