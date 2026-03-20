# Synapse Network

Synapse Network is an AI-native payment and settlement infrastructure for machine-to-machine API commerce.

Core idea:
- On-chain vault and deposit guarantee (USDC)
- Off-chain speed gateway for real-time billing and routing
- Credential-based API access for high-frequency AI-to-AI calls

## What This Repo Contains

This repository includes:
- Smart contracts and local-chain tooling (Hardhat)
- Python provider gateway (FastAPI) and SDK
- Frontend console (Next.js)
- Structured architecture and product documentation

Synapse-Network/
├── apps/
│   ├── gateway/               # 核心结算网关（FastAPI）
│   │   ├── src/
│   │   ├── tests/
│   │   ├── main.py            # 原 provider_fastapi 入口
│   │   ├── pyproject.toml
│   │   └── .env.example
│   └── frontend/              # Next.js 控制台
├── packages/
│   ├── sdk-python/            # 第三方 Python SDK
│   │   ├── synapse_client/
│   │   ├── tests/
│   │   └── pyproject.toml
│   └── contracts/             # 纯 Solidity/Hardhat 工作区
│       ├── src/               # solidity contracts（原 contracts/*.sol）
│       ├── scripts/           # 部署脚本
│       ├── test/
│       ├── hardhat.config.js
│       └── package.json
├── infra/
│   ├── docker/                # 原 docker-compose 及 postgres init
│   └── env/                   # env 模板与说明（不放密钥）
├── docs/                      # 原 doc/
├── tools/                     # 运维/开发脚本（原 scripts/）

## Quick Start (Local)

### 1) One-command local environment

From repo root:

```bash
chmod +x scripts/local/setup_local_env.sh
./scripts/local/setup_local_env.sh
```

This script will start local chain, deploy contracts, start backend, and run frontend.

### 2) Restart / stop

```bash
chmod +x scripts/local/restart_local_env.sh
./scripts/local/restart_local_env.sh

chmod +x scripts/local/stop_local_env.sh
./scripts/local/stop_local_env.sh
```

### 3) Prod backend scripts (provider_fastapi only)

Prod scripts only manage `gateway/provider_fastapi.py` and do not start local Anvil or deploy localhost contracts.

```bash
chmod +x scripts/prod/start_prod_env.sh
./scripts/prod/start_prod_env.sh

chmod +x scripts/prod/restart_prod_env.sh
./scripts/prod/restart_prod_env.sh

chmod +x scripts/prod/stop_prod_env.sh
./scripts/prod/stop_prod_env.sh
```

### 4) Frontend only

```bash
cd apps/frontend
yarn install
yarn dev
```

### 4.1) Frontend CI gate

From repo root:

```bash
npm run ci:frontend
```

This runs the frontend quality checks currently enforced in the repository CI chain:

- `yarn lint`
- `yarn test`
- `yarn build`

### 4.2) Pull request CI gate

From repo root:

```bash
npm run ci:pr
```

This aggregates the repository PR checks currently wired in:

- `apps/frontend`: lint / test / build
- `admin/admin-front`: lint / build
- `gateway`: create `gateway/.venv`, install dependencies, run pytest
- `admin/gateway-admin`: create `admin/gateway-admin/.venv`, install dependencies, run pytest
- `provider_service`: create `provider_service/.venv`, install dependencies, run pytest
- `sdk/python`: create `sdk/python/.venv`, install editable package dependencies, run pytest unit coverage + `python -m build`; live gateway demo test is opt-in
- root contracts: hardhat compile, plus hardhat test when root contract tests exist

Current Python packaging target in this repository:

- `sdk/python`: distributable Python SDK package (`pyproject.toml` present)

Current Python service projects that do not run `python -m build` in CI:

- `gateway`
- `admin/gateway-admin`
- `provider_service`

These three are runtime service processes, not Python distribution packages today.

### 5) Python backend only

```bash
cd gateway
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
.venv/bin/python provider_fastapi.py
```

## Documentation Map

All docs are under [docs/](docs/README.md).

Contribution workflow and quality gates are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Weekly Execution Board

Storage and production-hardening work items are tracked here:

- Release and gate baseline: [docs/05_DevOps_Deployment/02_CI_CD_and_Release_Gates.md](docs/05_DevOps_Deployment/02_CI_CD_and_Release_Gates.md)
- Production operations and incident response: [docs/05_DevOps_Deployment/04_Financial_Incident_Response_and_Production_Operations.md](docs/05_DevOps_Deployment/04_Financial_Incident_Response_and_Production_Operations.md)
- Product roadmap board: [docs/01_Product_Vision/ROADMAP.md](docs/01_Product_Vision/ROADMAP.md)

This week focus:
- P0 financial safety baseline: transaction atomicity, row-level locks, idempotency unique constraints
- P0 backup and restore readiness: full + incremental backup and one restore drill
- P1 logging partitioning baseline: monthly partitions and retention policy
- Delivery gate: P0 complete before any public production exposure

GitHub issue templates for direct assignment:
- Board checklist: [.github/ISSUE_TEMPLATE/production-upgrade-checklist.md](.github/ISSUE_TEMPLATE/production-upgrade-checklist.md)
- Single work item: [.github/ISSUE_TEMPLATE/production-upgrade-work-item.md](.github/ISSUE_TEMPLATE/production-upgrade-work-item.md)
- Official docs entrypoint: [docs/README.md](docs/README.md)

### 1) Product and Frontend
- [docs/01_Product_Frontend](docs/01_Product_Frontend)

### 2) System Architecture
- [docs/02_System_Architecture](docs/02_System_Architecture)

### 3) Core Workflows
- [docs/03_Core_Workflows](docs/03_Core_Workflows)

### 4) Database Design
- [docs/04_Database_Design](docs/04_Database_Design)

### 5) DevOps and Deployment
- [docs/05_DevOps_Deployment](docs/05_DevOps_Deployment)

### 6) Reference
- [docs/06_Reference](docs/06_Reference)

## Main Project Structure

```text
Synapse-Network/
	contracts/                # Solidity contracts
	scripts/                  # Deploy scripts + local/prod operation scripts
	test/                     # Contract tests
	gateway/                  # FastAPI settlement gateway
	sdk/python/               # Python client SDK
	frontend/                 # Next.js dashboard and developer console
	docker-compose/           # Optional infra services
	docs/                     # Product, architecture, protocol, and operation docs
```

## Current API Entry Points

- Gateway health: `GET /health`
- Credential lifecycle: `/api/v1/credentials/*`
- Paid invoke: `POST /api/v1/gateway/generate`
- Deposit and balance flow: `/api/v1/balance/*`

## Design Principles

- Stateless speed gateway
- Strict credential and quota enforcement
- USDC-native accounting model
- Clear separation of router, service, model, and storage layers

## Notes

- Runtime JSON files are centralized under `gateway/runtime_storage/` and ignored from Git.
- For architecture and protocol details, start from [docs/README.md](docs/README.md).

