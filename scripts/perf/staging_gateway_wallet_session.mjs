#!/usr/bin/env node
import { ethers } from "ethers";
import {
  assertStagingHttpUrl,
  projectIdFromEnv,
  readStagingSecret,
} from "../lib/e2e_env_guard.mjs";

const gatewayBase = (
  process.env.SYNAPSE_GATEWAY_BASE_URL ||
  "https://api-staging.synapse-network.ai"
).replace(/\/+$/, "");
const projectId = projectIdFromEnv();

function shQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "'\"'\"'")}'`;
}

function secret(secretId) {
  return readStagingSecret(secretId, { projectId });
}

async function authWallet(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const challengeResponse = await fetch(
    `${gatewayBase}/api/v1/auth/challenge?address=${encodeURIComponent(
      wallet.address
    )}`
  );
  const challengePayload = await challengeResponse.json().catch(() => ({}));
  if (!challengeResponse.ok) {
    throw new Error(`challenge failed: ${challengeResponse.status}`);
  }
  const message = challengePayload.challenge || challengePayload.message;
  const signature = await wallet.signMessage(message);
  const verifyResponse = await fetch(`${gatewayBase}/api/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      wallet_address: wallet.address,
      message,
      signature,
    }),
  });
  const verifyPayload = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok) {
    throw new Error(`verify failed: ${verifyResponse.status}`);
  }
  const token =
    verifyPayload.access_token ||
    verifyPayload.accessToken ||
    verifyPayload.token;
  if (!token) {
    throw new Error("verify response missing token");
  }
  return { address: wallet.address, token };
}

const existingOwnerToken = process.env.SYNAPSE_OWNER_TOKEN || "";
const existingAgentCredential =
  process.env.SYNAPSE_AGENT_CREDENTIAL || process.env.SYNAPSE_AGENT_TOKEN || "";
const existingWallet = process.env.SYNAPSE_OWNER_WALLET || "";
try {
  assertStagingHttpUrl("SYNAPSE_GATEWAY_BASE_URL", gatewayBase);
} catch (error) {
  console.error(`FATAL STAGING-GATEWAY-SESSION-000: ${error.message}`);
  process.exit(1);
}
if (existingOwnerToken && existingAgentCredential && existingWallet) {
  process.exit(0);
}

const privateKey =
  process.env.GATEWAY_E2E_OWNER_KEY ||
  secret("synapse-staging-e2e-consumer-private-key");
if (!privateKey) {
  console.error(
    "FATAL STAGING-GATEWAY-SESSION-001: missing GATEWAY_E2E_OWNER_KEY or PROJECT_ID for Secret Manager lookup."
  );
  process.exit(1);
}

try {
  const auth = await authWallet(privateKey);
  let agentCredential = existingAgentCredential;
  if (!agentCredential) {
    const issueResponse = await fetch(
      `${gatewayBase}/api/v1/credentials/agent/issue`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${auth.token}`,
          "X-User-Address": auth.address,
        },
        body: JSON.stringify({
          name: `staging-load-${Date.now()}`,
          expiresInSec: 7200,
          maxCalls: 100000,
          rpm: 1200,
          resetInterval: "never",
        }),
      }
    );
    const issuePayload = await issueResponse.json().catch(() => ({}));
    if (!issueResponse.ok || issuePayload?.status !== "success") {
      throw new Error(`credential issue failed: ${issueResponse.status}`);
    }
    agentCredential = issuePayload?.credential?.token || "";
    if (!agentCredential) {
      throw new Error("credential issue response missing token");
    }
  }
  if (!existingOwnerToken)
    console.log(`export SYNAPSE_OWNER_TOKEN=${shQuote(auth.token)}`);
  if (!existingAgentCredential) {
    console.log(`export SYNAPSE_AGENT_CREDENTIAL=${shQuote(agentCredential)}`);
    console.log(`export SYNAPSE_AGENT_TOKEN=${shQuote(agentCredential)}`);
  }
  if (!existingWallet)
    console.log(`export SYNAPSE_OWNER_WALLET=${shQuote(auth.address)}`);
} catch (error) {
  console.error(`FATAL STAGING-GATEWAY-SESSION-002: ${error.message}`);
  process.exit(1);
}
