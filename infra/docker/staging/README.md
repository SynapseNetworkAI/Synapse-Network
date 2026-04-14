# Staging Infrastructure Stack

This folder defines the minimum shared infrastructure that the staging environment needs before the gateway, admin, and frontend services can start processing traffic.

## Components

- `postgres`: hosts both `synapse_gateway` and `synapse_gateway_admin` via the init scripts in `infra/postgres/init/`. Separate app / readonly / migrator roles are provisioned from the environment variables you provide.
- `redis`: shared cache and rate-limit store with password enforcement.
- `kafka` + `kafka-ui`: analytics event bus and inspection UI (KRaft mode, no ZooKeeper).
- `clickhouse`: analytics warehouse seeded from `infra/clickhouse/init`.

## Usage

```bash
cd infra/docker/staging
cp .env.example .env   # replace every placeholder with a staging secret
# Generate a Kafka cluster ID once: docker run --rm bitnami/kafka:3.7 kafka-storage.sh random-uuid
# Bring the shared services online
docker compose --env-file .env up -d
# Verify health
docker compose --env-file .env ps
```

Shortcut scripts are available under `scripts/staging/`:

```bash
# bring the stack up (optional service names can be passed through)
bash scripts/staging/start_infra.sh

# stop and remove containers
bash scripts/staging/stop_infra.sh
```

Set `POSTGRES_PASSWORD`, `*_APP_PASSWORD`, `*_READONLY_PASSWORD`, and `*_MIGRATOR_PASSWORD` to unique strong values; these are consumed by `infra/postgres/init`. The Compose file also limits exposed ports to `127.0.0.1`. Open firewall tunnels or SSH forwards if remote teams need access instead of removing the bind restriction.
