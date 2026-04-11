-- Synapse Analytics — ClickHouse Schema
-- Executed automatically by clickhouse/clickhouse-server on first start.
-- Mount path: /docker-entrypoint-initdb.d/01_analytics_schema.sql

CREATE DATABASE IF NOT EXISTS synapse_analytics;

-- ── Main events table ──────────────────────────────────────────────────────
-- Columnar storage with LowCardinality on high-repetition string fields.
-- Flexible properties stored as JSON string, queryable via JSONExtract*.

CREATE TABLE IF NOT EXISTS synapse_analytics.events
(
    event_id       UUID,
    event_name     LowCardinality(String),
    timestamp      DateTime64(3, 'UTC'),
    distinct_id    String,
    source         LowCardinality(String),  -- frontend | gateway | provider_service | sdk

    -- Promoted common properties (columnar for fast GROUP BY / WHERE)
    role           LowCardinality(String) DEFAULT '',
    surface        LowCardinality(String) DEFAULT '',
    env            LowCardinality(String) DEFAULT 'local',
    chain_id       UInt32 DEFAULT 0,
    session_id     String DEFAULT '',
    page_path      String DEFAULT '',
    correlation_id String DEFAULT '',

    -- UTM attribution
    utm_source     LowCardinality(String) DEFAULT '',
    utm_medium     LowCardinality(String) DEFAULT '',
    utm_campaign   String DEFAULT '',
    utm_content    String DEFAULT '',

    -- All remaining business properties stored as JSON
    properties     String DEFAULT '{}'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(toDateTime(timestamp))
ORDER BY (event_name, distinct_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 365 DAY  -- DateTime64 requires explicit cast for TTL
SETTINGS index_granularity = 8192;

-- ── Kafka Engine table ─────────────────────────────────────────────────────
-- Consumes raw JSON messages from Kafka topic synapse.analytics.events.
-- Requires Kafka to be running and the topic to exist.

CREATE TABLE IF NOT EXISTS synapse_analytics.events_kafka
(
    raw String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'synapse.analytics.events',
    kafka_group_name = 'clickhouse_analytics_consumer',
    kafka_format = 'JSONAsString',
    kafka_num_consumers = 1,
    kafka_skip_broken_messages = 1000;

-- ── Materialized View: Kafka → events ─────────────────────────────────────
-- Runs on every Kafka batch and populates the main events table.

CREATE MATERIALIZED VIEW IF NOT EXISTS synapse_analytics.events_kafka_mv
TO synapse_analytics.events AS
SELECT
    toUUID(JSONExtractString(raw, 'event_id'))                           AS event_id,
    JSONExtractString(raw, 'event_name')                                 AS event_name,
    parseDateTimeBestEffortOrNull(JSONExtractString(raw, 'timestamp'))   AS timestamp,
    JSONExtractString(raw, 'distinct_id')                                AS distinct_id,
    JSONExtractString(raw, 'source')                                     AS source,
    JSONExtractString(raw, 'properties', 'role')                        AS role,
    JSONExtractString(raw, 'properties', 'surface')                     AS surface,
    JSONExtractString(raw, 'properties', 'env')                         AS env,
    toUInt32OrZero(JSONExtractString(raw, 'properties', 'chain_id'))    AS chain_id,
    JSONExtractString(raw, 'properties', 'session_id')                  AS session_id,
    JSONExtractString(raw, 'properties', 'page_path')                   AS page_path,
    JSONExtractString(raw, 'properties', 'correlation_id')              AS correlation_id,
    JSONExtractString(raw, 'properties', 'utm_source')                  AS utm_source,
    JSONExtractString(raw, 'properties', 'utm_medium')                  AS utm_medium,
    JSONExtractString(raw, 'properties', 'utm_campaign')                AS utm_campaign,
    JSONExtractString(raw, 'properties', 'utm_content')                 AS utm_content,
    JSONExtractRaw(raw, 'properties')                                    AS properties
FROM synapse_analytics.events_kafka
WHERE parseDateTimeBestEffortOrNull(JSONExtractString(raw, 'timestamp')) IS NOT NULL;
