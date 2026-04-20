#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const COMPOSE_FILE = path.join(ROOT, "infra/docker/local/docker-compose.yml");
const GATEWAY_LOG = path.join(ROOT, "services/gateway/logs/provider_api.log");
const GATEWAY_HEALTH_URL = process.env.GATEWAY_BASE_URL
  ? `${process.env.GATEWAY_BASE_URL.replace(/\/+$/, "")}/health`
  : "http://127.0.0.1:8000/health";
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/0";
const KAFKA_BOOTSTRAP = process.env.ANALYTICS_KAFKA_BOOTSTRAP_SERVERS || "localhost:9092";
const CLICKHOUSE_URL = (process.env.ANALYTICS_CLICKHOUSE_URL || "http://127.0.0.1:8123").replace(/\/+$/, "");

function log(message) {
  console.log(`[analytics-10k-prepare] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }
  return result.stdout || "";
}

function detectCompose() {
  const candidates = [
    ["docker", ["compose", "-f", COMPOSE_FILE, "config", "--services"]],
    ["docker-compose", ["-f", COMPOSE_FILE, "config", "--services"]],
  ];
  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    if (result.status === 0 && result.stdout.includes("redis") && result.stdout.includes("kafka") && result.stdout.includes("clickhouse")) {
      return { command, prefixArgs: args.slice(0, args.indexOf("config")) };
    }
  }
  fail("Neither docker compose nor docker-compose can parse infra/docker/local/docker-compose.yml.");
}

async function waitFor(name, fn, { timeoutMs = 60000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await fn()) {
        log(`${name} ready`);
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  fail(`${name} did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`);
}

function parseRedisUrl(value) {
  const url = new URL(value);
  return { host: url.hostname || "127.0.0.1", port: Number.parseInt(url.port || "6379", 10) };
}

async function redisPing() {
  const { host, port } = parseRedisUrl(REDIS_URL);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 2000 }, () => {
      socket.write("*1\r\n$4\r\nPING\r\n");
    });
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      socket.end();
    });
    socket.on("end", () => resolve(data.includes("PONG")));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function httpOk(url, method = "GET") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, { method, signal: controller.signal });
    return response.ok;
  } finally {
    clearTimeout(timer);
  }
}

async function clickHouseQuery(sql) {
  const response = await fetch(`${CLICKHOUSE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: `${sql.trim()}\nFORMAT JSONEachRow\n`,
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`ClickHouse query failed: ${response.status} ${text.slice(0, 1000)}`);
  }
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function tailGatewayLog(lines = 120) {
  if (!fs.existsSync(GATEWAY_LOG)) {
    return "(gateway log does not exist yet)";
  }
  return fs.readFileSync(GATEWAY_LOG, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

async function waitForGatewayStrictKafkaLog() {
  await waitFor("gateway strict Kafka log", () => {
    if (!fs.existsSync(GATEWAY_LOG)) {
      return false;
    }
    const logText = fs.readFileSync(GATEWAY_LOG, "utf8").slice(-20000);
    if (logText.includes("Analytics: File-only mode")) {
      fail(`Gateway started in File-only analytics mode during strict dogfood.\n${tailGatewayLog()}`);
    }
    return logText.includes("Analytics: Strict Kafka");
  }, { timeoutMs: 20000, intervalMs: 500 });
}

async function main() {
  if (!fs.existsSync(COMPOSE_FILE)) {
    fail(`compose file not found: ${COMPOSE_FILE}`);
  }
  const compose = detectCompose();
  log(`using ${compose.command} ${compose.prefixArgs.join(" ")}`);
  run(compose.command, [...compose.prefixArgs, "up", "-d", "redis", "kafka", "clickhouse"]);

  await waitFor("Redis", redisPing, { timeoutMs: 60000 });
  await waitFor("Kafka", () => {
    const result = spawnSync("docker", [
      "exec",
      "synapse-kafka",
      "/opt/kafka/bin/kafka-topics.sh",
      "--bootstrap-server",
      "localhost:9092",
      "--list",
    ], { encoding: "utf8", stdio: "pipe" });
    return result.status === 0;
  }, { timeoutMs: 120000, intervalMs: 3000 });
  await waitFor("ClickHouse", () => httpOk(`${CLICKHOUSE_URL}/ping`), { timeoutMs: 90000 });
  const tables = await clickHouseQuery(`
    SELECT name
    FROM system.tables
    WHERE database = 'synapse_analytics'
      AND name IN ('events', 'events_kafka', 'events_kafka_mv')
  `);
  const tableNames = new Set(tables.map((row) => row.name));
  for (const required of ["events", "events_kafka", "events_kafka_mv"]) {
    if (!tableNames.has(required)) {
      fail(`ClickHouse analytics table missing: synapse_analytics.${required}`);
    }
  }

  log("restarting Gateway with Redis + strict Kafka analytics");
  run("sh", ["scripts/local/restart_gateway.sh"], {
    env: {
      REDIS_URL,
      ANALYTICS_KAFKA_BOOTSTRAP_SERVERS: KAFKA_BOOTSTRAP,
      ANALYTICS_KAFKA_TOPIC: process.env.ANALYTICS_KAFKA_TOPIC || "synapse.analytics.events",
      ANALYTICS_STRICT_KAFKA: "1",
      V2_BACKFILL_ENABLED: process.env.V2_BACKFILL_ENABLED || "0",
      V2_RECONCILIATION_ENABLED: process.env.V2_RECONCILIATION_ENABLED || "0",
      PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED: process.env.PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED || "0",
      CONSUMER_WITHDRAW_PROCESSOR_ENABLED: process.env.CONSUMER_WITHDRAW_PROCESSOR_ENABLED || "0",
      SERVICE_HEALTH_MONITOR_ENABLED: process.env.SERVICE_HEALTH_MONITOR_ENABLED || "0",
      FORWARDING_REQUIRE_HEALTHY_TARGETS: process.env.FORWARDING_REQUIRE_HEALTHY_TARGETS || "0",
      DOWNSTREAM_ADAPTIVE_QUEUE_LIMIT: process.env.DOWNSTREAM_ADAPTIVE_QUEUE_LIMIT || "10000",
      DOWNSTREAM_ADAPTIVE_LATENCY_TARGET_MS: process.env.DOWNSTREAM_ADAPTIVE_LATENCY_TARGET_MS || "10000",
      DOWNSTREAM_ADAPTIVE_CIRCUIT_FAILURE_THRESHOLD: process.env.DOWNSTREAM_ADAPTIVE_CIRCUIT_FAILURE_THRESHOLD || "10000",
      STARTUP_TIMEOUT_SEC: process.env.STARTUP_TIMEOUT_SEC || "30",
    },
  });

  await waitFor("Gateway health", () => httpOk(GATEWAY_HEALTH_URL), { timeoutMs: 30000 });
  await waitForGatewayStrictKafkaLog();
  log("local strict analytics dependencies are ready");
}

main().catch((error) => {
  console.error(`[analytics-10k-prepare] fatal: ${error.stack || error.message || String(error)}`);
  console.error("[analytics-10k-prepare] gateway log tail:");
  console.error(tailGatewayLog());
  process.exit(1);
});
