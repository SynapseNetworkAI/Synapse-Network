#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const { getAddress, keccak256 } = require("ethers");

function usage() {
  console.error(`Usage:
  node scripts/chain/gcp_kms_derive_eth_address.mjs <kms-key-version-resource>

Example:
  node scripts/chain/gcp_kms_derive_eth_address.mjs \\
    projects/fabled-archive-494108-k5/locations/us-central1/keyRings/synapse-staging/cryptoKeys/synapse-staging-withdraw-signer/cryptoKeyVersions/1

The script reads the Cloud KMS public key only. It never reads private key material.`);
}

function parseKeyVersionResource(resource) {
  const match = String(resource || "").match(
    /^projects\/([^/]+)\/locations\/([^/]+)\/keyRings\/([^/]+)\/cryptoKeys\/([^/]+)\/cryptoKeyVersions\/([^/]+)$/
  );
  if (!match) {
    throw new Error("expected full KMS cryptoKeyVersion resource path");
  }
  return {
    project: match[1],
    location: match[2],
    keyRing: match[3],
    key: match[4],
    version: match[5],
  };
}

function fetchPublicKeyPem(parts) {
  const output = execFileSync(
    "gcloud",
    [
      "kms",
      "keys",
      "versions",
      "get-public-key",
      parts.version,
      "--project",
      parts.project,
      "--location",
      parts.location,
      "--keyring",
      parts.keyRing,
      "--key",
      parts.key,
      "--format=json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(output);
  if (!parsed.pem) {
    throw new Error("gcloud response did not include public key PEM");
  }
  return parsed.pem;
}

function spkiToUncompressedPoint(pem) {
  const publicKey = crypto.createPublicKey(pem);
  const der = publicKey.export({ type: "spki", format: "der" });
  for (let index = der.length - 65; index >= 0; index -= 1) {
    const point = der.subarray(index, index + 65);
    if (point[0] === 0x04) {
      return point;
    }
  }
  throw new Error(
    "could not find uncompressed secp256k1 public key point in SPKI DER"
  );
}

function ethereumAddressFromPoint(point) {
  const digest = keccak256(`0x${point.subarray(1).toString("hex")}`);
  return getAddress(`0x${digest.slice(-40)}`);
}

function main() {
  const resource =
    process.argv[2] || process.env.WITHDRAW_SIGNER_GCP_KMS_KEY_NAME || "";
  if (!resource) {
    usage();
    process.exit(2);
  }
  const parts = parseKeyVersionResource(resource);
  const pem = fetchPublicKeyPem(parts);
  const point = spkiToUncompressedPoint(pem);
  const address = ethereumAddressFromPoint(point);
  console.log(
    JSON.stringify(
      {
        kmsKeyVersion: resource,
        publicKeyFormat: "secp256k1-spki-pem",
        ethereumAddress: address,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(`FATAL KMS-DERIVE-001: ${error.message}`);
  process.exit(1);
}
