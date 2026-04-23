const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function isLocalUrl(value) {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLocalDsn(value) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(String(value || ""));
}

export function assertSeedEnvironment({
  scriptName,
  allowStaging = false,
  runId = "",
  dsn = "",
  urls = [],
} = {}) {
  const seedEnv = String(process.env.SYNAPSE_SEED_ENV || "local").trim().toLowerCase();
  if (!["local", "staging"].includes(seedEnv)) {
    throw new Error(`${scriptName || "seed"} refuses to run in ${seedEnv || "<empty>"}; prod seeds are forbidden.`);
  }

  if (seedEnv === "local") {
    if (dsn && !isLocalDsn(dsn)) {
      throw new Error(`${scriptName || "seed"} refuses local seed against a non-local Postgres DSN.`);
    }
    const nonLocalUrl = urls.find((url) => url && !isLocalUrl(url));
    if (nonLocalUrl) {
      throw new Error(`${scriptName || "seed"} refuses local seed against non-local URL: ${nonLocalUrl}`);
    }
    return seedEnv;
  }

  if (!allowStaging) {
    throw new Error(`${scriptName || "seed"} is local-only. Staging evidence must use a dedicated guarded seed.`);
  }

  const stagingRunId = runId || process.env.SYNAPSE_SEED_RUN_ID || "";
  if (!stagingRunId.trim()) {
    throw new Error(`${scriptName || "seed"} staging seed requires a runId/SYNAPSE_SEED_RUN_ID for cleanup and audit.`);
  }
  return seedEnv;
}
