import test from "node:test";
import assert from "node:assert/strict";

import {
  BASELINE_POLICY_COMMANDS,
  BASELINE_QUALITY_COMMANDS,
  BASELINE_STATIC_COMMANDS,
  isDocsFile,
  isFullTriggerFile,
  isKnownFile,
} from "./resolve_pr_ci_scope_rules.mjs";
import { classifyScriptChange } from "./resolve_pr_ci_scope_package.mjs";

test("baseline shards keep the expected command split", () => {
  assert.deepEqual(BASELINE_STATIC_COMMANDS, [
    "runtime_preflight",
    "ci_meta_checks",
    "local_runtime_guard_scan",
    "security_secret_scan",
    "e2e_env_isolation_check",
  ]);
  assert.deepEqual(BASELINE_QUALITY_COMMANDS, [
    "code_quality_architecture_scan",
    "quality_budget_check",
    "format_check",
    "diff_coverage_gate",
  ]);
  assert.deepEqual(BASELINE_POLICY_COMMANDS, [
    "security_money_scan",
    "security_money_ts_scan",
    "finance_approval_safety_scan",
    "finance_mypy_scan",
    "e2e_script_model_drift_scan",
    "docs_checks",
    "release_go_no_go_checks",
    "monitoring_alert_rules",
  ]);
});

test("docs files remain docs-classified", () => {
  assert.equal(isDocsFile("docs/reference/Validation_Entry_Points.md"), true);
  assert.equal(isDocsFile("llms.txt"), true);
  assert.equal(
    isDocsFile("services/docs-front/src/components/docs/EnvironmentConfig.tsx"),
    true,
  );
  assert.equal(isDocsFile("scripts/ops/gcp_billing_review.sh"), false);
});

test("workflow, ci, and ops files are known without forcing full CI", () => {
  const narrowFiles = [
    ".github/workflows/pr-ci.yml",
    "scripts/ci/resolve_pr_ci_scope.mjs",
    "scripts/ops/gcp_billing_review.sh",
    "scripts/git/cleanup_old_branches.sh",
    "package-lock.json",
  ];

  for (const file of narrowFiles) {
    assert.equal(isKnownFile(file), true, `${file} should be known`);
    assert.equal(
      isFullTriggerFile(file),
      false,
      `${file} should not force full CI`,
    );
  }
});

test("deploy and non-npm lockfile changes still fail closed into full CI", () => {
  const fullFiles = ["scripts/deploy/migrate_db.sh", "yarn.lock"];

  for (const file of fullFiles) {
    assert.equal(
      isFullTriggerFile(file),
      true,
      `${file} should remain full-trigger`,
    );
  }
});

test("root npm lockfile no longer forces full CI by itself", () => {
  assert.equal(isKnownFile("package-lock.json"), true);
  assert.equal(isFullTriggerFile("package-lock.json"), false);
});

test("public docs package scripts map to narrow docs scopes", () => {
  assert.deepEqual(
    classifyScriptChange(
      "docs:sync-public-mirror",
      "node scripts/tools/sync_public_docs_mirror.mjs",
    ),
    {
      commands: ["docs_checks"],
      riskScopes: ["docs-public-mirror"],
    },
  );

  assert.deepEqual(
    classifyScriptChange(
      "ci:prod-public-docs-links-evidence",
      "node scripts/ci/prod_public_docs_links_evidence_check.mjs",
    ),
    {
      commands: ["docs_checks", "e2e_script_model_drift_scan"],
      riskScopes: ["docs-public-links"],
    },
  );
});

test("GCP gross cost audit package script maps to narrow ops scope", () => {
  assert.deepEqual(
    classifyScriptChange(
      "ci:gcp-gross-cost-audit",
      "node scripts/ops/gcp_gross_cost_audit.mjs",
    ),
    {
      commands: ["ci_meta_checks", "quality_budget_check", "docs_checks"],
      riskScopes: ["gcp-cost-audit"],
    },
  );
});
