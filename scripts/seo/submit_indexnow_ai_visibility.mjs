#!/usr/bin/env node

import process from "node:process";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_KEY = "4f58d9a2e2c84f85a5f3b5baf9a65c7d";
const WWW_HOST = "www.synapse-network.ai";
const DOCS_HOST = "docs.synapse-network.ai";

const batches = [
  {
    host: WWW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: `https://${WWW_HOST}/${INDEXNOW_KEY}.txt`,
    urlList: [
      "https://www.synapse-network.ai/",
      "https://www.synapse-network.ai/ai-agent-payments",
      "https://www.synapse-network.ai/agent-payment-api",
      "https://www.synapse-network.ai/mcp-server-for-paid-api-calls",
      "https://www.synapse-network.ai/chatgpt-mcp-app-api-payments",
      "https://www.synapse-network.ai/llms.txt",
      "https://www.synapse-network.ai/llms-full.txt",
      "https://www.synapse-network.ai/robots.txt",
      "https://www.synapse-network.ai/sitemap.xml",
    ],
  },
  {
    host: DOCS_HOST,
    key: INDEXNOW_KEY,
    keyLocation: `https://${DOCS_HOST}/${INDEXNOW_KEY}.txt`,
    urlList: [
      "https://docs.synapse-network.ai/",
      "https://docs.synapse-network.ai/ai-agent-payments",
      "https://docs.synapse-network.ai/ai-agent-payments/agent-payment-api",
      "https://docs.synapse-network.ai/ai-agent-payments/agent-pays-for-llm-calls",
      "https://docs.synapse-network.ai/ai-agent-payments/provider-monetization",
      "https://docs.synapse-network.ai/ai-agent-payments/receipts-and-budget-isolation",
      "https://docs.synapse-network.ai/ai-agent-payments/synapse-vs-x402",
      "https://docs.synapse-network.ai/ai-agent-payments/faq",
      "https://docs.synapse-network.ai/mcp",
      "https://docs.synapse-network.ai/mcp/paid-api-calls",
      "https://docs.synapse-network.ai/mcp/synapse-vs-paid-mcp",
      "https://docs.synapse-network.ai/mcp/brand-disambiguation",
      "https://docs.synapse-network.ai/llms.txt",
      "https://docs.synapse-network.ai/llms-full.txt",
      "https://docs.synapse-network.ai/robots.txt",
      "https://docs.synapse-network.ai/sitemap.xml",
    ],
  },
];

function parseArgs(argv) {
  return {
    execute: argv.includes("--execute"),
    endpoint:
      argv
        .find((arg) => arg.startsWith("--endpoint="))
        ?.slice("--endpoint=".length) || INDEXNOW_ENDPOINT,
  };
}

async function submitBatch(endpoint, batch) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(batch),
  });
  return {
    host: batch.host,
    status: response.status,
    ok: response.ok,
    responseText: await response.text(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.execute) {
    console.log(
      JSON.stringify(
        {
          execute: false,
          endpoint: options.endpoint,
          message:
            "Dry run only. Pass --execute after prod deploy to submit IndexNow notifications.",
          batches,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const results = [];
  for (const batch of batches) {
    results.push(await submitBatch(options.endpoint, batch));
  }
  const failed = results.filter((result) => !result.ok);
  console.log(
    JSON.stringify(
      { execute: true, endpoint: options.endpoint, results },
      null,
      2,
    ),
  );
  return failed.length === 0 ? 0 : 1;
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
