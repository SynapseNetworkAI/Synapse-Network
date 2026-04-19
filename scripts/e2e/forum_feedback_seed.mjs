#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "tmp/forum-feedback-dogfood");
const FIXTURE_PATH = process.env.FORUM_FEEDBACK_FIXTURE
  ? path.resolve(process.env.FORUM_FEEDBACK_FIXTURE)
  : path.join(OUT_DIR, "fixture.json");
const FORUM_BASE_URL = (process.env.FORUM_BASE_URL || process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || process.env.USER_FRONT_GATEWAY_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const RPC_URL = process.env.USER_FRONT_RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const RUN_ID = process.env.FORUM_FEEDBACK_RUN_ID || `forum-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;

const DEFAULT_AUTHOR_KEY = "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07";
const AUTHOR_KEY = process.env.FORUM_FEEDBACK_AUTHOR_KEY || DEFAULT_AUTHOR_KEY;

const EXPECTED = {
  docsFeedbackMessage: `Docs feedback dogfood ${RUN_ID} route=/docs privateKey=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
  dashboardFeedbackMessage: `Dashboard feedback dogfood ${RUN_ID} route=/dashboard/discovery Bearer seed-secret-token-abcdef`,
  seedTopicTitle: `Seeded forum dogfood topic ${RUN_ID}`,
  seedTopicBody: `Seeded baseline body for ${RUN_ID}. This topic proves API writes and resolved state before browser dogfood starts.`,
  seedReplyBody: `Seeded baseline reply for ${RUN_ID}.`,
  uiTopicTitle: `UI forum dogfood topic ${RUN_ID}`,
  uiTopicBody: `UI created body for ${RUN_ID}. This should be written through the visible Forum form and reconciled in Postgres.`,
  uiReplyBody: `UI created reply for ${RUN_ID}.`,
  uiDocsFeedbackMessage: `UI docs feedback dogfood ${RUN_ID}`,
  uiDashboardFeedbackMessage: `UI dashboard feedback dogfood ${RUN_ID}`,
};

function log(message) {
  console.log(`[forum-feedback-seed] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  const usesDefaultKey = AUTHOR_KEY === DEFAULT_AUTHOR_KEY;
  if (usesDefaultKey && CHAIN_ID !== 31337) {
    fail("Refusing to use the default forum dogfood key outside CHAIN_ID=31337.");
  }
  if (usesDefaultKey && (!isLocalUrl(FORUM_BASE_URL) || !isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(RPC_URL))) {
    fail("Refusing to use the default forum dogfood key against non-localhost endpoints.");
  }
}

async function assertReachable(name, url, { allowNonOk = false, attempts = 4, timeoutMs = 60000 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!allowNonOk && !response.ok) {
        fail(`${name} is not ready: ${response.status} ${response.statusText} at ${url}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      log(`${name} reachability retry ${attempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      clearTimeout(timer);
    }
  }
  fail(`${name} is not reachable at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function api(pathname, { method = "GET", token, address, body, headers = {} } = {}) {
  const requestHeaders = {
    Accept: "application/json",
    ...headers,
  };
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  if (address) {
    requestHeaders["X-User-Address"] = address;
  }
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    fail(`${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return payload;
}

async function authenticate() {
  const wallet = new ethers.Wallet(AUTHOR_KEY);
  const address = wallet.address;
  const challenge = await api(`/v1/auth/challenge?address=${encodeURIComponent(address)}`);
  const message = challenge.challenge || challenge.message;
  if (!message) {
    fail("Auth challenge missing message");
  }
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token = verified.access_token || verified.token || verified.accessToken;
  if (!token) {
    fail("Auth verification did not return a token");
  }
  return {
    address,
    token,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

async function main() {
  assertLocalOnly();
  await assertReachable("gateway", `${GATEWAY_BASE_URL}/health`);
  await assertReachable("user-front", FORUM_BASE_URL, { allowNonOk: true });

  const author = await authenticate();
  log(`authenticated as ${author.address}`);

  const docsFeedback = await api("/v1/feedback", {
    method: "POST",
    token: author.token,
    address: author.address,
    body: {
      source: "docs",
      sentiment: "not_helpful",
      category: "docs_issue",
      message: EXPECTED.docsFeedbackMessage,
      route: `/docs/support?runId=${RUN_ID}`,
      pageTitle: "Developer Support",
      language: "en",
      context: {
        runId: RUN_ID,
        authorization: "Bearer seed-secret-token-abcdef",
        privateKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    },
  });

  const dashboardFeedback = await api("/v1/feedback", {
    method: "POST",
    token: author.token,
    address: author.address,
    body: {
      source: "dashboard",
      sentiment: "report_issue",
      category: "provider_services",
      message: EXPECTED.dashboardFeedbackMessage,
      route: `/dashboard/discovery?runId=${RUN_ID}`,
      pageTitle: "Discovery",
      language: "en",
      context: {
        runId: RUN_ID,
        query: RUN_ID,
        token: "seed-agent-token",
        providerSecret: "seed-provider-secret",
      },
    },
  });

  const topicResult = await api("/v1/forum/topics", {
    method: "POST",
    token: author.token,
    address: author.address,
    body: {
      title: EXPECTED.seedTopicTitle,
      body: EXPECTED.seedTopicBody,
      category: "Questions",
    },
  });
  const topicId = topicResult.topic?.topicId;
  if (!topicId) {
    fail("Topic creation did not return topicId");
  }

  const replyResult = await api(`/v1/forum/topics/${encodeURIComponent(topicId)}/replies`, {
    method: "POST",
    token: author.token,
    address: author.address,
    body: { body: EXPECTED.seedReplyBody },
  });
  const replyId = replyResult.reply?.replyId;
  if (!replyId) {
    fail("Reply creation did not return replyId");
  }

  await api(`/v1/forum/topics/${encodeURIComponent(topicId)}/resolve`, {
    method: "POST",
    token: author.token,
    address: author.address,
  });

  const fixture = {
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrls: {
      frontend: FORUM_BASE_URL,
      gateway: GATEWAY_BASE_URL,
      rpc: RPC_URL,
    },
    author,
    expected: EXPECTED,
    seed: {
      docsFeedbackId: docsFeedback.feedbackId,
      dashboardFeedbackId: dashboardFeedback.feedbackId,
      topicId,
      replyId,
    },
  };

  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2));
  log(`fixture written to ${path.relative(ROOT, FIXTURE_PATH)}`);
  log(`topic ${topicId}, reply ${replyId}, feedback ${docsFeedback.feedbackId}/${dashboardFeedback.feedbackId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
