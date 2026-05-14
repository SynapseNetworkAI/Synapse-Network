import assert from "node:assert/strict";
import test from "node:test";

import {
  immutableImageRef,
  parseTaggedArtifactRegistryImage,
} from "./resolve_artifact_registry_image_digests.mjs";

test("parseTaggedArtifactRegistryImage extracts host, path, and tag", () => {
  const parsed = parseTaggedArtifactRegistryImage(
    "us-central1-docker.pkg.dev/example-project/synapse-staging/gateway-admin:staging-main-abc123"
  );

  assert.deepEqual(parsed, {
    immutable: false,
    imageName:
      "us-central1-docker.pkg.dev/example-project/synapse-staging/gateway-admin",
    tag: "staging-main-abc123",
    host: "us-central1-docker.pkg.dev",
    path: "example-project/synapse-staging/gateway-admin",
  });
});

test("parseTaggedArtifactRegistryImage keeps immutable refs untouched", () => {
  assert.deepEqual(
    parseTaggedArtifactRegistryImage(
      "us-central1-docker.pkg.dev/example-project/synapse-staging/gateway@sha256:abc"
    ),
    {
      immutable: true,
      imageName:
        "us-central1-docker.pkg.dev/example-project/synapse-staging/gateway@sha256:abc",
      tag: "",
      host: "",
      path: "",
    }
  );
});

test("immutableImageRef replaces only the tag with the digest", () => {
  assert.equal(
    immutableImageRef(
      "us-central1-docker.pkg.dev/example-project/synapse-staging/gateway:tag",
      "sha256:123"
    ),
    "us-central1-docker.pkg.dev/example-project/synapse-staging/gateway@sha256:123"
  );
});

test("parseTaggedArtifactRegistryImage rejects refs without explicit tag", () => {
  assert.equal(
    parseTaggedArtifactRegistryImage(
      "us-central1-docker.pkg.dev/example-project/synapse-staging/gateway"
    ),
    null
  );
});
