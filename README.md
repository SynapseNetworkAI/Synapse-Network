# Synapse Network

Synapse Network is an AI-native payment and settlement infrastructure for machine-to-machine API commerce.

Core idea:
- On-chain vault and deposit guarantee (USDC)
- Off-chain speed gateway for real-time billing and routing
- Credential-based API access for high-frequency AI-to-AI calls

## What This Repo Contains

This repository includes:
- Smart contracts and local-chain tooling (Hardhat)
- Python seller gateway (FastAPI) and SDK
- Frontend console (Next.js)
- Structured architecture and product documentation

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

### 3) Prod backend scripts (seller_fastapi only)

Prod scripts only manage `python_sdk/seller_api/seller_fastapi.py` and do not start local Anvil or deploy localhost contracts.

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
cd frontend
yarn install
yarn dev
```

### 5) Python backend only

```bash
cd python_sdk
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 seller_api/seller_fastapi.py
```

## Documentation Map

All docs are under [doc/](doc/README.md).

Contribution workflow and quality gates are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Weekly Execution Board

Storage and production-hardening work items are tracked here:

- Strategy doc: [doc/02_Architecture/Storage_Strategy_Upgrade.md](doc/02_Architecture/Storage_Strategy_Upgrade.md)
- Execution TODO: [doc/02_Architecture/Production_Upgrade_TODO.md](doc/02_Architecture/Production_Upgrade_TODO.md)
- Product roadmap board: [doc/01_Product_Vision/ROADMAP.md](doc/01_Product_Vision/ROADMAP.md)

This week focus:
- P0 financial safety baseline: transaction atomicity, row-level locks, idempotency unique constraints
- P0 backup and restore readiness: full + incremental backup and one restore drill
- P1 logging partitioning baseline: monthly partitions and retention policy
- Delivery gate: P0 complete before any public production exposure

GitHub issue templates for direct assignment:
- Board checklist: [.github/ISSUE_TEMPLATE/production-upgrade-checklist.md](.github/ISSUE_TEMPLATE/production-upgrade-checklist.md)
- Single work item: [.github/ISSUE_TEMPLATE/production-upgrade-work-item.md](.github/ISSUE_TEMPLATE/production-upgrade-work-item.md)
- Issue seed list (copy-and-create): [doc/02_Architecture/Production_Upgrade_Issue_Seeds.md](doc/02_Architecture/Production_Upgrade_Issue_Seeds.md)

### 1) Product Vision
- [doc/01_Product_Vision](doc/01_Product_Vision)

### 2) Architecture
- [doc/02_Architecture](doc/02_Architecture)

### 3) Smart Contract and Payment
- [doc/03_Smart_Contract_Payment](doc/03_Smart_Contract_Payment)

### 4) Agent Network and Protocol
- [doc/04_Synapse_Network](doc/04_Synapse_Network)

### 5) Frontend UX
- [doc/05_Frontend_UX](doc/05_Frontend_UX)

### 6) Developer Guides
- [doc/06_Developer_Guides](doc/06_Developer_Guides)

## Main Project Structure

```text
Synapse-Network/
	contracts/                # Solidity contracts
	scripts/                  # Deploy scripts + local/prod operation scripts
	test/                     # Contract tests
	python_sdk/               # FastAPI gateway + Python SDK + runtime storage
	frontend/                 # Next.js dashboard and developer console
	docker-compose/           # Optional infra services
	doc/                      # Product, architecture, protocol, and operation docs
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

- Runtime JSON files are centralized under `python_sdk/runtime_storage/` and ignored from Git.
- For architecture and protocol details, start from [doc/README.md](doc/README.md).

