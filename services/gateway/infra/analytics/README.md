# Analytics Test Infrastructure

Local Kafka + ClickHouse setup for running analytics integration and E2E tests.

## Quick Start

```bash
# Start infrastructure
cd services/gateway/infra/analytics
docker compose up -d

# Wait for services to be healthy
docker compose ps

# Run integration tests (Kafka only)
cd ../..
ANALYTICS_TEST_KAFKA=true pytest tests/integration/test_analytics_kafka_integration.py -v

# Run E2E tests (Kafka + ClickHouse)
ANALYTICS_TEST_E2E=true pytest tests/e2e/test_analytics_e2e_pipeline.py -v --timeout=60

# Run data quality health check
python scripts/analytics_health_check.py

# Tear down
cd infra/analytics
docker compose down -v
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| Kafka | 9092 | Event message broker |
| ClickHouse | 8123 (HTTP), 9000 (native) | Analytics event storage |
| Kafka UI | 8080 | Visual topic inspector |

## ClickHouse Schema

Schema is auto-initialized from `clickhouse/init.sql` on first start.
Matches the production schema from `docs/projects/frontend/Synapse_Analytics_Tracking_Plan.md`.
