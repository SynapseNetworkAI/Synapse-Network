#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { ethers } from "ethers";

const gatewayBase = (process.env.SYNAPSE_GATEWAY_BASE_URL || "https://api-staging.synapse-network.ai").replace(/\/+$/, "");
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.CLOUDSDK_CORE_PROJECT || "";

function shQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "'\"'\"'")}'`;
}

function secret(secretId) {
  if (!projectId) return "";
  const result = spawnSync("gcloud", [
    "secrets",
    "versions",
    "access",
    "latest",
    `--secret=${secretId}`,
    `--project=${projectId}`,
  ], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function authWallet(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const challengeResponse = await fetch(`${gatewayBase}/api/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`);
  const challengePayload = await challengeResponse.json().catch(() => ({}));
  if (!challengeResponse.ok) {
    throw new Error(`challenge failed: ${challengeResponse.status}`);
  }
  const message = challengePayload.challenge || challengePayload.message;
  const signature = await wallet.signMessage(message);
  const verifyResponse = await fetch(`${gatewayBase}/api/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ wallet_address: wallet.address, message, signature }),
  });
  const verifyPayload = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok) {
    throw new Error(`verify failed: ${verifyResponse.status}`);
  }
  const token = verifyPayload.access_token || verifyPayload.accessToken || verifyPayload.token;
  if (!token) {
    throw new Error("verify response missing token");
  }
  return { address: wallet.address, token };
}

const existingOwnerToken = process.env.SYNAPSE_OWNER_TOKEN || "";
const existingAgentToken = process.env.SYNAPSE_AGENT_TOKEN || "";
const existingWallet = process.env.SYNAPSE_OWNER_WALLET || "";
if (existingOwnerToken && existingAgentToken && existingWallet) {
  process.exit(0);
}

const privateKey = process.env.GATEWAY_E2E_OWNER_KEY || secret("synapse-staging-e2e-consumer-private-key");
if (!privateKey) {
  console.error("FATAL STAGING-GATEWAY-SESSION-001: missing GATEWAY_E2E_OWNER_KEY or PROJECT_ID for Secret Manager lookup.");
  process.exit(1);
}

try {
  const auth = await authWallet(privateKey);
  if (!existingOwnerToken) console.log(`export SYNAPSE_OWNER_TOKEN=${shQuote(auth.token)}`);
  if (!existingAgentToken) console.log(`export SYNAPSE_AGENT_TOKEN=${shQuote(auth.token)}`);
  if (!existingWallet) console.log(`export SYNAPSE_OWNER_WALLET=${shQuote(auth.address)}`);
} catch (error) {
  console.error(`FATAL STAGING-GATEWAY-SESSION-002: ${error.message}`);
  process.exit(1);
}
