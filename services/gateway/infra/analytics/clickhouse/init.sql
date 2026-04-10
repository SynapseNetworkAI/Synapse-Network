-- Synapse Analytics ClickHouse Schema
-- Automatically executed on container startup

CREATE DATABASE IF NOT EXISTS synapse_analytics;

CREATE TABLE IF NOT EXISTS synapse_analytics.events
(
    event_id       UUID,
    event_name     LowCardinality(String),
    timestamp      DateTime64(3, 'UTC'),
    distinct_id    String,
    source         LowCardinality(String),

    -- Common properties
    role           LowCardinality(String) DEFAULT '',
    surface        LowCardinality(String) DEFAULT '',
    env            LowCardinality(String) DEFAULT 'prod',
    chain_id       UInt32 DEFAULT 0,
    session_id     String DEFAULT '',
    page_path      String DEFAULT '',
    correlation_id String DEFAULT '',

    -- UTM
    utm_source     LowCardinality(String) DEFAULT '',
    utm_medium     LowCardinality(String) DEFAULT '',
    utm_campaign   String DEFAULT '',
    utm_content    String DEFAULT '',

    -- Flexible properties
    properties     String DEFAULT '{}'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_name, distinct_id, timestamp)
TTL timestamp + INTERVAL 365 DAY
SETTINGS index_granularity = 8192;

-- Note: Kafka Engine table is created separately when Kafka is connected.
-- For E2E testing, events are inserted directly via the HTTP interface
-- after being consumed from Kafka by the test harness.
