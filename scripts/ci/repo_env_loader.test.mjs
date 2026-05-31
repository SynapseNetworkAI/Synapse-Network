import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

const repoRoot = new URL("../..", import.meta.url).pathname;
const loaderPath = join(repoRoot, "scripts/lib/load_repo_env.sh");

function runBash(script) {
  return spawnSync("bash", ["-lc", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, SYNAPSE_ENV_FILE: "" },
  });
}

test("repo env loader exports keys without printing values", () => {
  const dir = mkdtempSync(join(tmpdir(), "synapse-repo-env-"));
  try {
    writeFileSync(
      join(dir, "env.local"),
      [
        "# plain local config",
        "PUBLIC_GATEWAY_BASE_URL=http://127.0.0.1:8000",
        'FEATURE_FLAGS_JSON="{\"local\":true}"',
        "export NEXT_PUBLIC_APP_ENV=local",
        "EMPTY_VALUE=",
        "",
      ].join("\n"),
    );

    const result = runBash(
      [
        `source "${loaderPath}"`,
        `load_synapse_repo_env local "${dir}"`,
        'printf "%s\\n" "${PUBLIC_GATEWAY_BASE_URL}|${FEATURE_FLAGS_JSON}|${NEXT_PUBLIC_APP_ENV}|${EMPTY_VALUE}"',
      ].join("; "),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.trim(),
      'http://127.0.0.1:8000|{"local":true}|local|',
    );
    assert.match(result.stderr, /loaded 4 keys from env\.local/);
    assert.doesNotMatch(result.stderr, /127\.0\.0\.1:8000/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repo env loader rejects invalid keys without echoing line values", () => {
  const dir = mkdtempSync(join(tmpdir(), "synapse-repo-env-"));
  try {
    writeFileSync(join(dir, "env.staging"), "BAD-KEY=super-secret-value\n");

    const result = runBash(
      [
        `source "${loaderPath}"`,
        `load_synapse_repo_env staging "${dir}"`,
      ].join("; "),
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid key/);
    assert.doesNotMatch(result.stderr, /super-secret-value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
