import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../.."
);
const SCRIPT = path.join(ROOT, "scripts/ci/frontend_scope_plan.mjs");

function runPlan(scope) {
  const dir = mkdtempSync(path.join(tmpdir(), "frontend-scope-plan-"));
  const scopePath = path.join(dir, "scope.json");
  writeFileSync(scopePath, JSON.stringify(scope));
  try {
    const raw = execFileSync("node", [SCRIPT, "--scope", scopePath], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return JSON.parse(raw);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("skips user-front shard when scope has no user-front or contract files", () => {
  const plan = runPlan({
    changedFiles: ["package-lock.json", "scripts/ci/resolve_pr_ci_scope.mjs"],
  });
  assert.equal(plan.skip, true);
  assert.equal(plan.integrationOnly, false);
  assert.equal(plan.runBuild, false);
  assert.equal(plan.runLint, false);
  assert.equal(plan.runRelatedTests, false);
});

test("contracts-only scope becomes integration-only build smoke", () => {
  const plan = runPlan({
    changedFiles: ["contracts/SynapseCore.sol"],
  });
  assert.equal(plan.skip, false);
  assert.equal(plan.integrationOnly, true);
  assert.equal(plan.runBuild, true);
  assert.equal(plan.runTypecheck, true);
  assert.equal(plan.runLint, false);
  assert.equal(plan.runRelatedTests, false);
});

test("user-front component change runs targeted lint, related tests, and build", () => {
  const plan = runPlan({
    changedFiles: [
      "services/user-front/src/components/provider-workspace/ProviderWithdrawPage.tsx",
    ],
  });
  assert.equal(plan.skip, false);
  assert.equal(plan.integrationOnly, false);
  assert.equal(plan.runLint, true);
  assert.equal(plan.runRelatedTests, true);
  assert.equal(plan.runBuild, true);
  assert.equal(plan.runUserErrorScan, true);
  assert.equal(plan.runErrorDom, true);
  assert.equal(plan.runProviderWithdrawMatureDom, true);
  assert.deepEqual(plan.lintFiles, [
    "src/components/provider-workspace/ProviderWithdrawPage.tsx",
  ]);
});

test("test-only user-front change skips build but keeps targeted related tests", () => {
  const plan = runPlan({
    changedFiles: [
      "services/user-front/src/components/PaidInvokePanel.test.tsx",
    ],
  });
  assert.equal(plan.runLint, true);
  assert.equal(plan.runRelatedTests, true);
  assert.equal(plan.runBuild, false);
  assert.equal(plan.runTypecheck, false);
  assert.equal(plan.runErrorDom, true);
});
