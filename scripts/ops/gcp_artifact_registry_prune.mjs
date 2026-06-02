#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";

const DEFAULT_REPOSITORIES = [
  {
    project: "fabled-archive-494108-k5",
    location: "us-central1",
    repository: "synapse-staging",
  },
  {
    project: "synapse-network-prod",
    location: "us-central1",
    repository: "synapse-prod",
  },
];

function parseArgs(argv) {
  const options = {
    concurrency: 6,
    dryRun: false,
    keep: 3,
    repositories: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--concurrency") {
      options.concurrency = Number.parseInt(argv[++index] ?? "", 10);
    } else if (arg === "--keep") {
      options.keep = Number.parseInt(argv[++index] ?? "", 10);
    } else if (arg === "--repo") {
      options.repositories.push(parseRepo(argv[++index] ?? ""));
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
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (options.repositories.length === 0) {
    options.repositories = DEFAULT_REPOSITORIES;
  }
  return options;
}

function parseRepo(value) {
  const [project, location, repository] = String(value).split("/");
  if (!project || !location || !repository) {
    throw new Error(`invalid --repo '${value}', expected project/location/repository`);
  }
  return { project, location, repository };
}

function usage(code) {
  console.error(`Usage:
  node scripts/ops/gcp_artifact_registry_prune.mjs [--dry-run] [--keep 3] [--concurrency 6] [--repo project/location/repository]

Defaults:
  fabled-archive-494108-k5/us-central1/synapse-staging
  synapse-network-prod/us-central1/synapse-prod

Notes:
  - Protects every digest currently referenced by Cloud Run services and jobs.
  - Keeps the newest N versions per Docker package, then deletes older unprotected versions.
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

function runAsync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed\n${stderr || stdout}`));
      }
    });
  });
}

function collectCloudRunImageRefs({ project, location }) {
  const refs = [];
  for (const kind of ["services", "jobs"]) {
    const rows = run(
      "gcloud",
      ["run", kind, "list", `--project=${project}`, `--region=${location}`, "--format=json"],
      { json: true, allowFailure: true }
    );
    for (const row of rows) {
      const containers = findContainers(row);
      for (const container of containers) {
        if (container.image) {
          refs.push(String(container.image));
        }
      }
    }
  }
  return refs;
}

function findContainers(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return [];
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => findContainers(item, seen));
  }
  const containers = Array.isArray(value.containers) ? value.containers : [];
  return [
    ...containers.filter((item) => item && typeof item === "object"),
    ...Object.entries(value)
      .filter(([key]) => key !== "containers")
      .flatMap(([, item]) => findContainers(item, seen)),
  ];
}

function parseImageRef(ref) {
  if (ref.includes("@sha256:")) {
    const [pkg, digest] = ref.split("@");
    return { package: pkg, digest, tag: null };
  }
  const slashIndex = ref.lastIndexOf("/");
  const colonIndex = ref.lastIndexOf(":");
  if (colonIndex > slashIndex) {
    return {
      package: ref.slice(0, colonIndex),
      digest: null,
      tag: ref.slice(colonIndex + 1),
    };
  }
  return { package: ref, digest: null, tag: null };
}

function listImages(repo) {
  const root = `${repo.location}-docker.pkg.dev/${repo.project}/${repo.repository}`;
  return run(
    "gcloud",
    ["artifacts", "docker", "images", "list", root, "--include-tags", "--format=json"],
    { json: true }
  ).map((row) => ({
    package: row.package,
    version: row.version,
    tags: Array.isArray(row.tags) ? row.tags : [],
    updateTime: row.updateTime ?? "",
  }));
}

function buildProtectedKeys(repo, images) {
  const protectedKeys = new Set();
  for (const ref of collectCloudRunImageRefs(repo)) {
    const parsed = parseImageRef(ref);
    if (parsed.digest) {
      protectedKeys.add(`${parsed.package}@${parsed.digest}`);
      continue;
    }
    if (parsed.tag) {
      for (const image of images) {
        if (image.package === parsed.package && image.tags.includes(parsed.tag)) {
          protectedKeys.add(`${image.package}@${image.version}`);
        }
      }
    }
  }
  return protectedKeys;
}

async function deleteImage(image, dryRun) {
  const imageRef = `${image.package}@${image.version}`;
  if (dryRun) {
    console.log(`[dry-run] delete ${imageRef}`);
    return;
  }
  await runAsync("gcloud", [
    "artifacts",
    "docker",
    "images",
    "delete",
    imageRef,
    "--delete-tags",
    "--quiet",
  ]);
  console.log(`[deleted] ${imageRef}`);
}

async function deleteInBatches(images, options) {
  let deleted = 0;
  for (let index = 0; index < images.length; index += options.concurrency) {
    const batch = images.slice(index, index + options.concurrency);
    await Promise.all(batch.map((image) => deleteImage(image, options.dryRun)));
    deleted += batch.length;
  }
  return deleted;
}

async function pruneRepo(repo, options) {
  const images = listImages(repo);
  const protectedKeys = buildProtectedKeys(repo, images);
  const byPackage = new Map();
  for (const image of images) {
    if (!byPackage.has(image.package)) {
      byPackage.set(image.package, []);
    }
    byPackage.get(image.package).push(image);
  }

  let deleted = 0;
  for (const [pkg, items] of [...byPackage.entries()].sort()) {
    items.sort((left, right) => String(right.updateTime).localeCompare(String(left.updateTime)));
    const keptRecent = new Set(items.slice(0, options.keep).map((item) => `${item.package}@${item.version}`));
    const deleteCandidates = items.filter((item) => {
      const key = `${item.package}@${item.version}`;
      return !keptRecent.has(key) && !protectedKeys.has(key);
    });
    console.log(
      `[artifact-prune] package=${pkg} versions=${items.length} keepRecent=${keptRecent.size} protected=${[...protectedKeys].filter((key) => key.startsWith(`${pkg}@`)).length} delete=${deleteCandidates.length}`
    );
    deleted += await deleteInBatches(deleteCandidates, options);
  }
  return { images: images.length, protected: protectedKeys.size, deleted };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = [];
  for (const repo of options.repositories) {
    console.log(
      `[artifact-prune] repo=${repo.project}/${repo.location}/${repo.repository} dryRun=${options.dryRun} keep=${options.keep} concurrency=${options.concurrency}`
    );
    summary.push({ ...repo, ...(await pruneRepo(repo, options)) });
  }
  console.log(`[artifact-prune] complete ${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
