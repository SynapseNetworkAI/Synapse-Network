#!/usr/bin/env node

import fs from "node:fs";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DEFAULT_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] || fallback;
}

export function parseTaggedArtifactRegistryImage(image) {
  if (image.includes("@sha256:")) {
    return { immutable: true, imageName: image, tag: "", host: "", path: "" };
  }

  const slashIndex = image.lastIndexOf("/");
  const tagIndex = image.lastIndexOf(":");
  if (tagIndex === -1 || tagIndex < slashIndex) {
    return null;
  }

  const imageName = image.slice(0, tagIndex);
  const tag = image.slice(tagIndex + 1);
  const firstSlash = imageName.indexOf("/");
  if (firstSlash === -1 || !tag) {
    return null;
  }

  return {
    immutable: false,
    imageName,
    tag,
    host: imageName.slice(0, firstSlash),
    path: imageName.slice(firstSlash + 1),
  };
}

export function immutableImageRef(image, digest) {
  const parsed = parseTaggedArtifactRegistryImage(image);
  if (!parsed || parsed.immutable || !digest) {
    return image;
  }
  return `${parsed.imageName}@${digest}`;
}

export function isSameFilesystemPath(left, right) {
  if (!left || !right) {
    return false;
  }
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function accessToken() {
  return execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requestDigest({ host, path, tag, token }) {
  return new Promise((resolve) => {
    const request = https.request(
      {
        method: "HEAD",
        host,
        path: `/v2/${path}/manifests/${encodeURIComponent(tag)}`,
        headers: {
          Accept: DEFAULT_ACCEPT,
          Authorization: `Bearer ${token}`,
        },
      },
      (response) => {
        response.resume();
        const digest = response.headers["docker-content-digest"];
        if (
          response.statusCode &&
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          digest
        ) {
          resolve({ digest: String(digest), statusCode: response.statusCode });
          return;
        }
        resolve({ digest: "", statusCode: response.statusCode || 0 });
      }
    );
    request.on("error", (error) => resolve({ digest: "", error }));
    request.end();
  });
}

async function resolveImage(image, token) {
  const parsed = parseTaggedArtifactRegistryImage(image);
  if (!parsed) {
    console.warn(`[artifact-digest] skipped unsupported image ref: ${image}`);
    return image;
  }
  if (parsed.immutable) {
    return image;
  }

  const result = await requestDigest({ ...parsed, token });
  if (!result.digest) {
    const reason = result.error
      ? result.error.message
      : `HTTP ${result.statusCode || "unknown"}`;
    console.warn(
      `[artifact-digest] using tag ref for ${parsed.imageName}:${parsed.tag}; digest lookup failed: ${reason}`
    );
    return image;
  }
  return immutableImageRef(image, result.digest);
}

async function main() {
  const buildImagesPath = argValue("--build-images", "build-images.json");
  const outPath = argValue("--out", "image-digests.json");
  const build = JSON.parse(fs.readFileSync(buildImagesPath, "utf8"));
  const token = accessToken();
  const digests = {};

  for (const [service, image] of Object.entries(build.services || {})) {
    digests[service] = await resolveImage(image, token);
  }

  fs.writeFileSync(outPath, `${JSON.stringify(digests, null, 2)}\n`);
}

if (isSameFilesystemPath(process.argv[1], fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`[artifact-digest] ${error.message}`);
    process.exit(1);
  });
}
