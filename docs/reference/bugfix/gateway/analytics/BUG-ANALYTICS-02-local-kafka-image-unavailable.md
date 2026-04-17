# BUG-ANALYTICS-02 Local Kafka Image Unavailable

## Status

Fixed on 2026-04-16.

## Symptom

Running the local Analytics infrastructure failed before Kafka could start:

```text
docker.io/bitnami/kafka:3.7: not found
```

This blocked `ANALYTICS_TEST_E2E=true` and the new full-chain Admin Analytics verification, because Gateway can only feed ClickHouse-backed admin pages when events reach Kafka and the ClickHouse Kafka materialized view.

## Root Cause

`infra/docker/local/docker-compose.yml` referenced `bitnami/kafka:3.7`, which is no longer resolvable from Docker Hub in the current local environment.

## Fix

- Switched local Kafka to `apache/kafka:3.7.1`, verified by Docker manifest inspection.
- Updated KRaft environment variables from Bitnami-specific `KAFKA_CFG_*` names to Apache Kafka's `KAFKA_*` names.
- Updated the healthcheck to call `/opt/kafka/bin/kafka-topics.sh`.
- Split Kafka listeners so Gateway on the host uses `localhost:9092`, while ClickHouse in Docker uses `kafka:29092`.
- Updated the ClickHouse Kafka Engine schema to consume from `kafka:29092`.

## Verification

```bash
docker manifest inspect apache/kafka:3.7.1
docker-compose -f infra/docker/local/docker-compose.yml up -d kafka
curl -s http://localhost:8123/ --data "SHOW CREATE TABLE synapse_analytics.events_kafka"
```
