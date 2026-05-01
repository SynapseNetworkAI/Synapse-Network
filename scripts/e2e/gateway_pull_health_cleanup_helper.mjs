import { spawnSync } from "node:child_process";

export function runLocalCleanupDryEvidence({
  root,
  isStaging,
  postgresDsn,
  apiEvidence,
  addCheck,
  sanitize,
  redact,
}) {
  if (isStaging) return;
  const result = spawnSync(
    "bash",
    ["scripts/local/cleanup_service_registry_dev.sh"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        LOCAL_DEV_CLEANUP_DRY_RUN: "1",
        LOCAL_DEV_CLEANUP_OUTPUT: "json",
        LOCAL_GATEWAY_POSTGRES_DSN: postgresDsn,
      },
    }
  );
  const output = (result.stdout || "").trim();
  let parsed = null;
  try {
    parsed = output ? JSON.parse(output) : null;
  } catch {
    parsed = { raw: redact(output) };
  }
  apiEvidence.cleanup = {
    dryRunStatus: result.status,
    dryRun: sanitize(parsed),
    stderr: redact(result.stderr || "").slice(0, 1000),
  };
  addCheck(
    "local_cleanup_dry_evidence_available",
    result.status === 0 && Boolean(parsed),
    apiEvidence.cleanup,
    "Local cleanup dry-run evidence must be available before pull-health dogfood."
  );
}
