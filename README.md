<p align="center">
  <img src="./services/user-front/public/brand/synapse-network-logo.svg" alt="SynapseNetwork logo" width="460" />
</p>

# Synapse Network

Synapse Network is an AI-native payment and settlement infrastructure for machine-to-machine API commerce.

Core idea:

- On-chain vault and deposit guarantee (USDC)
- Off-chain speed gateway for real-time billing and routing
- Credential-based API access for high-frequency AI-to-AI calls

## Public Developer Entry

Current public preview integrations should start on staging:

- App docs: `https://docs-staging.synapse-network.ai/sdks`
- Gateway: `https://api-staging.synapse-network.ai`
- Chain: Arbitrum Sepolia testnet
- Asset: MockUSDC for integration testing, not production USDC
- Agent runtime credential: `SYNAPSE_AGENT_KEY=agt_xxx`

Recommended developer flow:

1. Connect a wallet in the staging Gateway Dashboard.
2. Generate or issue an Agent Key.
3. Use the official SDK or MCP server with `SYNAPSE_AGENT_KEY`.
4. Run a fixed-price API invoke with the discovered string price.
5. Run a token-metered LLM invoke with optional `maxCostUsdc`.
6. Read the invocation receipt and verify settlement metadata.

Production examples remain reserved until production DNS, contracts, gateway health, and public docs deployment are verified.

## What This Repo Contains

This repository includes:

- Smart contracts and contributor chain tooling
- Python provider gateway (FastAPI) and SDK
- Frontend console (Next.js)
- Structured architecture and product documentation

Synapse-Network/
├── apps/
│ ├── gateway/ # 核心结算网关（FastAPI）
│ │ ├── src/
│ │ ├── tests/
│ │ ├── main.py # 原 provider_fastapi 入口
│ │ ├── pyproject.toml
│ │ └── .env.example
│ └── frontend/ # Next.js 控制台
├── packages/
│ ├── sdk-python/ # 第三方 Python SDK
│ │ ├── synapse_client/
│ │ ├── tests/
│ │ └── pyproject.toml
│ └── contracts/ # 纯 Solidity/Hardhat 工作区
│ ├── src/ # solidity contracts（原 contracts/\*.sol）
│ ├── scripts/ # 部署脚本
│ ├── test/
│ ├── hardhat.config.js
│ └── package.json
├── docker-compose/ # canonical compose entry + postgres bootstrap SQL
├── docs/ # 原 doc/
├── tools/ # 运维/开发脚本（原 scripts/）

## Contributor/Internal Local Development

### 1) One-command local environment

From repo root:

```bash
npm run dev:all
```

This starts the four local app services: Gateway, Gateway-admin, User-front, and Admin-front.
It does not create databases, redeploy contracts, or rerun SQL bootstrap on every start.

Useful lifecycle commands:

```bash
npm run dev:migrate
npm run dev:bootstrap
npm run dev:status
npm run dev:logs
npm run dev:restart
npm run dev:stop
```

Use `npm run dev:migrate` when the gateway-admin schema is missing or after admin DB schema changes.
Use `npm run dev:bootstrap` once for first-time local infra setup: local Postgres bootstrap, Anvil, local contract deploy, Gateway, and User-front.

Provider marketplace visibility helpers:

```bash
npm run dev:provider:onboard
npm run dev:provider:probe
npm run dev:provider:status
```

`dev:provider:onboard` runs the sibling Provider onboarding flow and waits until the registered services are visible in Gateway public discovery. `dev:provider:probe` re-runs the local ensure + force-probe path for the current Provider services when marketplace looks stale. `dev:provider:status` prints discovery and health snapshots without mutating state.

If you only need the lower-level runtime Gateway + User-front subset, use the setup script directly:

```bash
chmod +x scripts/local/setup_local_env.sh
./scripts/local/setup_local_env.sh
```

That script will start local chain, deploy contracts, start Gateway, and run User-front.
It now auto-activates `Node.js 20.19.0` through `nvm` when the current shell is still on an older Node runtime.

If the script says `anvil is not installed`, install Foundry first:

```bash
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup
anvil --version
```

If `anvil` is still not found in the current shell, run:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
anvil --version
```

### 2) Restart / stop

```bash
chmod +x scripts/local/restart_local_env.sh
./scripts/local/restart_local_env.sh

chmod +x scripts/local/stop_local_env.sh
./scripts/local/stop_local_env.sh
```

### 3) Staging backend scripts (provider_fastapi only)

Staging scripts only manage `gateway/provider_fastapi.py` and do not start local Anvil or deploy localhost contracts.

```bash
chmod +x scripts/staging/start_staging_env.sh
./scripts/staging/start_staging_env.sh

chmod +x scripts/staging/restart_staging_env.sh
./scripts/staging/restart_staging_env.sh

chmod +x scripts/staging/stop_staging_env.sh
./scripts/staging/stop_staging_env.sh
```

### 3.1) Prod backend scripts (provider_fastapi only)

Prod scripts manage the final public profile after staging is stable.

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

- source API shape: public service/API methods must return typed objects, not raw `dict` / `Record<string, unknown>`; legacy debt is baselined in `scripts/ci/source_quality_baseline.json`
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

### 6) Gateway env templates

Gateway env templates live under `gateway/`:

- `.env.local.example`: local bootstrap template
- `.env.staging.example`: shared testnet / demo template
- `.env.prod.example`: production bootstrap template
- `.env.example`: full variable catalog

If you want Provider withdrawals to work, these are hard requirements:

- `PRIVATE_KEY`: gateway-side withdraw signer private key used to issue EIP-712 withdrawal tickets
- `RPC_URL`: chain RPC used by withdraw signing, deposit sync, and reconciliation
- `ROUTER_ADDRESS`: deployed SynapseCore contract address

Recommended local flow:

1. Copy `gateway/.env.local.example` to `gateway/.env.local`.
2. Fill `PRIVATE_KEY`, `RPC_URL`, `ROUTER_ADDRESS`, `POSTGRES_DSN`, `JWT_SECRET`.
3. Restart the gateway with `./scripts/local/restart_gateway.sh` or `bash scripts/local/restart_gateway.sh`.

Where does `PRIVATE_KEY` come from?

- Local dev: use a private key from your local chain test accounts. Anvil / Hardhat usually prints funded dev accounts and their private keys at startup.
- Staging / production: use a dedicated withdraw signer account managed by your infra stack, ideally injected via Secret Manager, KMS, or HSM-backed workflows.

Do not use a personal browser-wallet mnemonic or commit a real production private key into the repository.

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

## Deployment Automation

Repository-level deployment execution now uses:

1. `.github/workflows/pr-ci.yml`
2. `.github/workflows/deploy-staging.yml`
3. `.github/workflows/deploy-production.yml`
4. `scripts/deploy/staging.sh`
5. `scripts/deploy/production.sh`
6. `scripts/deploy/rollback.sh`

These workflows are designed to be triggered by `Synapse-Network-Growing`, which acts as the deploy control plane for staging/prod promotion and rollback audit.

Staging deploy authentication uses Google Cloud Workload Identity Federation.
`deploy-staging.yml` requires `GCP_WORKLOAD_IDENTITY_PROVIDER` and
`GCP_DEPLOY_SERVICE_ACCOUNT` GitHub Actions secrets in addition to the staging
project, region, Artifact Registry repository, and evidence bucket secrets. Do
not add or commit a GCP service account JSON key.

## Lowest-cost rollout recommendation

For the current pre-launch phase, the default recommendation is:

1. start with a single `staging` GCE VM
2. co-host `Synapse-Network`, `Synapse-Network-Provider`, Postgres, Kafka, ClickHouse, and reverse proxy on that machine
3. deploy through `GitHub Actions -> SSH -> staging deploy script`
4. postpone the dedicated `prod` VM until staging is stable and support / backup / monitoring are in place

Operational runbook:

- [docs/ops/09_Staging_First_GCE_Rollout.md](docs/ops/09_Staging_First_GCE_Rollout.md)

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

- Gateway runtime state is stored in PostgreSQL; `runtime_storage/` is no longer part of the active persistence path.
- For architecture and protocol details, start from [docs/README.md](docs/README.md).
