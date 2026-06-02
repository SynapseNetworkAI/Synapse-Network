#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const DEFAULT_TARGETS = [
  {
    project: "fabled-archive-494108-k5",
    secret: "x-official-oauth2-refresh-token",
  },
];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    keep: 1,
    targets: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--keep") {
      options.keep = Number.parseInt(argv[++index] ?? "", 10);
    } else if (arg === "--target") {
      options.targets.push(parseTarget(argv[++index] ?? ""));
    } else if (arg === "-h" || arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error("--keep must be a positive integer");
  }
  if (options.targets.length === 0) {
    options.targets = DEFAULT_TARGETS;
  }
  return options;
}

function parseTarget(value) {
  const [project, secret] = String(value).split("/");
  if (!project || !secret) {
    throw new Error(`invalid --target '${value}', expected project/secret`);
  }
  return { project, secret };
}

function usage(code) {
  console.error(`Usage:
  node scripts/ops/gcp_secret_versions_prune.mjs [--dry-run] [--keep 1] [--target project/secret]

Defaults:
  --target fabled-archive-494108-k5/x-official-oauth2-refresh-token

Notes:
  - Never reads or prints secret values.
  - Keeps the newest enabled version(s), destroys older enabled versions.
`);
  process.exit(code);
}

function run(command, args, { json = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`
    );
  }
  if (json) {
    return JSON.parse(result.stdout || "[]");
  }
  return result.stdout;
}

function listEnabledVersions({ project, secret }) {
  const rows = run(
    "gcloud",
    [
      "secrets",
      "versions",
      "list",
      secret,
      `--project=${project}`,
      "--filter=state:ENABLED",
      "--sort-by=~createTime",
      "--format=json",
    ],
    { json: true }
  );
  return rows.map((row) => ({
    version: String(row.name ?? "").split("/").at(-1),
    createTime: row.createTime ?? "",
    state: row.state ?? "",
  }));
}

function destroyVersion({ project, secret, version, dryRun }) {
  const label = `${project}/${secret}/versions/${version}`;
  if (dryRun) {
    console.log(`[dry-run] destroy ${label}`);
    return;
  }
  run("gcloud", [
    "secrets",
    "versions",
    "destroy",
    version,
    `--secret=${secret}`,
    `--project=${project}`,
    "--quiet",
  ]);
  console.log(`[destroyed] ${label}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = {
    dryRun: options.dryRun,
    keep: options.keep,
    targets: [],
    destroyed: 0,
  };

  for (const target of options.targets) {
    const versions = listEnabledVersions(target);
    const keep = versions.slice(0, options.keep);
    const remove = versions.slice(options.keep);
    console.log(
      `[secret-prune] target=${target.project}/${target.secret} enabled=${versions.length} keep=${keep.length} delete=${remove.length}`
    );
    for (const version of keep) {
      console.log(
        `[keep] ${target.project}/${target.secret}/versions/${version.version} ${version.createTime}`
      );
    }
    for (const version of remove) {
      destroyVersion({ ...target, version: version.version, dryRun: options.dryRun });
      summary.destroyed += 1;
    }
    summary.targets.push({
      ...target,
      enabledBefore: versions.length,
      kept: keep.map((item) => item.version),
      deleted: remove.map((item) => item.version),
    });
  }

  console.log(`[secret-prune] complete ${JSON.stringify(summary)}`);
}

main();
