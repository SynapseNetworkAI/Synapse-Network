# Service Port Map

This page is the canonical local port map for Synapse development.

Rule: local frontend projects use `3000 + n*100`. Backend and admin API ports stay stable unless a migration explicitly changes them.

## Local Services

| Project         | Local URL               | Purpose                                                              |
| --------------- | ----------------------- | -------------------------------------------------------------------- |
| `user-front`    | `http://localhost:3000` | Main console, marketplace, dashboard, and owner/developer product UI |
| `docs-front`    | `http://localhost:3100` | Dedicated developer docs site                                        |
| `admin-front`   | `http://localhost:3200` | Admin control-plane UI                                               |
| `gateway`       | `http://127.0.0.1:8000` | Runtime Gateway API                                                  |
| `provider`      | `http://127.0.0.1:8100` | Local provider runtime                                               |
| `gateway-admin` | `http://127.0.0.1:8300` | Admin API                                                            |
| `postgres`      | `127.0.0.1:15432`       | Local Docker Postgres                                                |
| `otterscan`     | `http://localhost:5100` | Local chain explorer for Anvil/Hardhat RPC                           |
| `anvil`         | `127.0.0.1:8545`        | Local chain                                                          |

## Deployment Rule

Cloud Run container ports stay unchanged. Next.js containers still listen on `3000`; staging and production use domains for routing:

| Project         | Staging                                        | Production                             |
| --------------- | ---------------------------------------------- | -------------------------------------- |
| `user-front`    | `https://staging.synapse-network.ai`           | `https://synapse-network.ai`           |
| `docs-front`    | `https://docs-staging.synapse-network.ai`      | `https://docs.synapse-network.ai`      |
| `admin-front`   | `https://admin-staging.synapse-network.ai`     | `https://admin.synapse-network.ai`     |
| `gateway`       | `https://api-staging.synapse-network.ai`       | `https://api.synapse-network.ai`       |
| `gateway-admin` | `https://admin-api-staging.synapse-network.ai` | `https://admin-api.synapse-network.ai` |

## Env Defaults

Local user-front must point docs links at docs-front:

```bash
NEXT_PUBLIC_DOCS_BASE_URL=http://localhost:3100
```

Staging and production use docs domains:

```bash
NEXT_PUBLIC_DOCS_BASE_URL=https://docs-staging.synapse-network.ai
NEXT_PUBLIC_DOCS_BASE_URL=https://docs.synapse-network.ai
```
