import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  return env;
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    env: cleanGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeFixture() {
  const cwd = mkdtempSync(join(tmpdir(), "synapse-pr-scope-"));
  mkdirSync(join(cwd, "scripts/ci"), { recursive: true });
  cpSync(
    join(repoRoot, "scripts/ci/resolve_pr_ci_scope.mjs"),
    join(cwd, "scripts/ci/resolve_pr_ci_scope.mjs")
  );
  cpSync(
    join(repoRoot, "scripts/ci/resolve_pr_ci_scope_package.mjs"),
    join(cwd, "scripts/ci/resolve_pr_ci_scope_package.mjs")
  );
  cpSync(
    join(repoRoot, "scripts/ci/resolve_pr_ci_scope_rules.mjs"),
    join(cwd, "scripts/ci/resolve_pr_ci_scope_rules.mjs")
  );
  run("git", ["init"], cwd);
  run("git", ["config", "user.email", "ci@example.test"], cwd);
  run("git", ["config", "user.name", "CI Scope Test"], cwd);
  write(join(cwd, "package.json"), JSON.stringify({ scripts: {} }, null, 2));
  write(join(cwd, "docs/README.md"), "# docs\n");
  write(join(cwd, "services/user-front/src/page.tsx"), "export const x = 1;\n");
  write(
    join(cwd, "services/admin-front/src/page.tsx"),
    "export const x = 1;\n"
  );
  write(join(cwd, "services/gateway/src/app.py"), "print('gateway')\n");
  write(join(cwd, "scripts/ci/agent_lessons_check.mjs"), "console.log('ok')\n");
  write(join(cwd, ".github/workflows/pr-ci.yml"), "name: PR CI\n");
  run("git", ["add", "."], cwd);
  run("git", ["commit", "-m", "base"], cwd);
  return cwd;
}

function resolveAfterChange(changes) {
  const cwd = makeFixture();
  for (const [path, content] of Object.entries(changes)) {
    write(join(cwd, path), content);
  }
  run("git", ["add", "."], cwd);
  run("git", ["commit", "-m", "change"], cwd);
  const raw = run(
    "node",
    [
      "scripts/ci/resolve_pr_ci_scope.mjs",
      "--base",
      "HEAD~1",
      "--head",
      "HEAD",
    ],
    cwd
  );
  return JSON.parse(raw);
}

test("docs-only changes stay on baseline scope", () => {
  const scope = resolveAfterChange({
    "docs/README.md": "# docs\n\nupdated\n",
  });
  assert.equal(scope.mode, "auto");
  assert.equal(scope.failClosed, false);
  assert.equal(scope.docsOnly, true);
  assert.ok(scope.commands.includes("docs_checks"));
  assert.ok(!scope.commands.includes("frontend_checks"));
});

test("user-front changes select frontend without full CI", () => {
  const scope = resolveAfterChange({
    "services/user-front/src/page.tsx": "export const x = 2;\n",
  });
  assert.equal(scope.mode, "auto");
  assert.equal(scope.failClosed, false);
  assert.deepEqual(scope.affectedProjects, ["user-front"]);
  assert.ok(scope.commands.includes("frontend_checks"));
  assert.equal(scope.needsUserFrontDeps, true);
});

test("GitHub workflow changes run workflow static checks without full CI", () => {
  const scope = resolveAfterChange({
    ".github/workflows/pr-ci.yml": "name: PR CI\non: pull_request\n",
  });
  assert.equal(scope.mode, "auto");
  assert.equal(scope.failClosed, false);
  assert.ok(scope.riskScopes.includes("github-actions"));
  assert.ok(scope.commands.includes("github_actions_runtime_check"));
  assert.ok(scope.commands.includes("ci_meta_checks"));
});

test("PR resolver changes run CI meta checks without full CI", () => {
  const resolverSource = readFileSync(
    join(repoRoot, "scripts/ci/resolve_pr_ci_scope.mjs"),
    "utf8"
  );
  const scope = resolveAfterChange({
    "scripts/ci/resolve_pr_ci_scope.mjs": `${resolverSource}\n// test-only change\n`,
  });
  assert.equal(scope.mode, "auto");
  assert.equal(scope.failClosed, false);
  assert.ok(scope.riskScopes.includes("ci-meta"));
  assert.ok(scope.commands.includes("ci_meta_checks"));
});

test("security guardrail changes still fail closed into full CI", () => {
  const scope = resolveAfterChange({
    "scripts/ci/security_secret_scan.sh": "#!/usr/bin/env bash\nexit 0\n",
  });
  assert.equal(scope.mode, "full");
  assert.equal(scope.failClosed, true);
  assert.match(scope.reasons.join("\n"), /security\/finance CI guardrail/);
});

test("local PR package scripts map narrowly", () => {
  const scope = resolveAfterChange({
    "package.json": JSON.stringify(
      {
        scripts: {
          "ci:pr:local": "bash scripts/ci/pr_local.sh auto",
          "ci:pr:fast": "bash scripts/ci/pr_local.sh fast",
          "ci:pr:full": "bash scripts/ci/pr_local.sh full",
        },
      },
      null,
      2
    ),
  });
  assert.equal(scope.mode, "auto");
  assert.equal(scope.failClosed, false);
  assert.ok(scope.riskScopes.includes("ci-meta"));
  assert.ok(scope.commands.includes("ci_meta_checks"));
});

test("weekly hygiene package scripts map narrowly", () => {
  const scope = resolveAfterChange({
    "package.json": JSON.stringify(
      {
        scripts: {
          "weekly:hygiene": "node scripts/ops/weekly_hygiene.mjs",
          "ci:weekly-hygiene-evidence":
            "node scripts/ci/weekly_hygiene_evidence_check.mjs",
        },
      },
      null,
      2
    ),
  });
  assert.equal(scope.mode, "auto");
  assert.equal(scope.failClosed, false);
  assert.ok(scope.riskScopes.includes("weekly-hygiene"));
  assert.ok(scope.commands.includes("ci_meta_checks"));
  assert.ok(scope.commands.includes("quality_budget_check"));
  assert.ok(scope.commands.includes("docs_checks"));
});

test("weekly hygiene harness changes avoid full CI", () => {
  const scope = resolveAfterChange({
    "scripts/ops/weekly_hygiene.mjs": "console.log('weekly hygiene');\n",
  });
  assert.equal(scope.mode, "auto");
  assert.equal(scope.failClosed, false);
  assert.ok(scope.riskScopes.includes("weekly-hygiene"));
  assert.ok(scope.commands.includes("ci_meta_checks"));
  assert.ok(scope.commands.includes("quality_budget_check"));
  assert.ok(scope.commands.includes("docs_checks"));
});

test("unknown files still fail closed", () => {
  const scope = resolveAfterChange({
    "surprise/new-file.txt": "unknown\n",
  });
  assert.equal(scope.mode, "full");
  assert.equal(scope.failClosed, true);
  assert.match(scope.reasons.join("\n"), /unknown file category/);
});
