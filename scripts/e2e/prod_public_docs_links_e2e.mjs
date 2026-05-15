#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "");
const OUT_DIR = path.join(
  ROOT,
  "docs/evidence/prod/public-links",
  `${timestamp}-prod-public-links`
);

const PROD_ROOT = process.env.PROD_ROOT_URL || "https://www.synapse-network.ai";
const DOCS_ROOT = process.env.PROD_DOCS_URL || "https://docs.synapse-network.ai";
const API_ROOT = process.env.PROD_GATEWAY_URL || "https://api.synapse-network.ai";
const ADMIN_ROOT =
  process.env.PROD_ADMIN_URL || "https://admin.synapse-network.ai";
const ADMIN_API_ROOT =
  process.env.PROD_ADMIN_API_URL || "https://admin-api.synapse-network.ai";
const DOCS_REPO =
  process.env.PUBLIC_DOCS_REPO_URL ||
  "https://github.com/SynapseNetworkAI/Synapse-Network-Docs";

const checks = [];
const failed = [];
const trace = [];

function nowIso() {
  return new Date().toISOString();
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function markdownReport(report) {
  const lines = [
    "# Prod Public Docs Links E2E",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    "",
    "## Checks",
    "",
  ];

  for (const check of report.checks) {
    lines.push(
      `- ${check.ok ? "PASS" : "FAIL"} \`${check.name}\` - ${check.status} ${check.url}`
    );
  }

  if (report.failed.length > 0) {
    lines.push("", "## Failed", "");
    for (const failure of report.failed) {
      lines.push(`- \`${failure.name}\`: ${failure.detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function request(url, expectedStatuses, note = "") {
  const startedAt = nowIso();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "synapse-prod-public-links-e2e/1.0",
      },
    });
    const body = await response.text();
    const ok = expectedStatuses.includes(response.status);
    const detail = ok
      ? note || "expected status"
      : `expected one of ${expectedStatuses.join(", ")}, got ${response.status}`;
    trace.push({
      at: nowIso(),
      url,
      expectedStatuses,
      actualStatus: response.status,
      ok,
      note,
    });
    return {
      ok,
      status: response.status,
      body,
      detail,
      startedAt,
      finishedAt: nowIso(),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    trace.push({
      at: nowIso(),
      url,
      expectedStatuses,
      actualStatus: null,
      ok: false,
      note: detail,
    });
    return {
      ok: false,
      status: 0,
      body: "",
      detail,
      startedAt,
      finishedAt: nowIso(),
    };
  }
}

async function check(name, url, expectedStatuses, assertion, note = "") {
  const result = await request(url, expectedStatuses, note);
  let ok = result.ok;
  let detail = result.detail;

  if (ok && assertion) {
    try {
      await assertion(result.body, result.status);
    } catch (error) {
      ok = false;
      detail = error instanceof Error ? error.message : String(error);
    }
  }

  const entry = {
    name,
    url,
    status: result.status,
    ok,
    detail,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  };
  checks.push(entry);
  if (!ok) failed.push(entry);
}

function assertContains(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(`missing ${label}: ${fragment}`);
  }
}

async function inspectDocsOpenMenu(pageUrl, expectedGitHubUrl, expectedMarkdownUrl) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(pageUrl, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    const openButton = page.getByRole("button", { name: "Open", exact: true });
    await openButton.scrollIntoViewIfNeeded();
    await openButton.click({ force: true });
    await page.waitForTimeout(500);

    const githubLink = page.locator(`a[href="${expectedGitHubUrl}"]`).first();
    const markdownPath = new URL(expectedMarkdownUrl).pathname;
    const markdownLink = page.locator(`a[href="${markdownPath}"]`).first();

    await githubLink.waitFor({ state: "visible", timeout: 30000 });
    await markdownLink.waitFor({ state: "visible", timeout: 30000 });

    const githubHrefRaw = await githubLink.getAttribute("href");
    const markdownHrefRaw = await markdownLink.getAttribute("href");
    const githubHref = githubHrefRaw
      ? new URL(githubHrefRaw, pageUrl).href
      : githubHrefRaw;
    const markdownHref = markdownHrefRaw
      ? new URL(markdownHrefRaw, pageUrl).href
      : markdownHrefRaw;

    if (githubHref !== expectedGitHubUrl) {
      throw new Error(
        `Open in GitHub href mismatch; expected ${expectedGitHubUrl}, got ${githubHref}`
      );
    }
    if (markdownHref !== expectedMarkdownUrl) {
      throw new Error(
        `View as Markdown href mismatch; expected ${expectedMarkdownUrl}, got ${markdownHref}`
      );
    }
  } finally {
    await browser.close();
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

await check("www_home", `${PROD_ROOT}/`, [200], (body) => {
  assertContains(body, "Synapse", "homepage brand");
});

await check("www_llms", `${PROD_ROOT}/llms.txt`, [200], (body) => {
  assertContains(body, "https://docs.synapse-network.ai/api-reference", "api reference url");
  assertContains(body, "https://docs.synapse-network.ai/support", "support url");
});

await check("docs_home", `${DOCS_ROOT}/`, [200], (body) => {
  assertContains(body, "Documentation", "docs homepage content");
});

await check("docs_api_reference", `${DOCS_ROOT}/api-reference`, [200], (body) => {
  assertContains(body, "API Reference", "api reference title");
});

await check(
  "docs_get_started",
  `${DOCS_ROOT}/get-started/agent-builders`,
  [200],
  (body) => {
    assertContains(body, "Agent Builders", "agent builders title");
  }
);

await check("docs_sdks", `${DOCS_ROOT}/sdks/typescript`, [200], (body) => {
  assertContains(body, "TypeScript", "typescript sdk title");
});

await check(
  "docs_smart_contracts",
  `${DOCS_ROOT}/smart-contracts/synapse-core`,
  [200],
  (body) => {
    assertContains(body, "SynapseCore", "smart contracts title");
  }
);

await check("docs_support", `${DOCS_ROOT}/support`, [200], (body) => {
  assertContains(body, "Support", "support title");
});

await check(
  "docs_api_reference_markdown",
  `${DOCS_ROOT}/llms.mdx/docs/api-reference/content.md`,
  [200],
  (body) => {
    assertContains(body, "# API Reference", "markdown heading");
  }
);

await check(
  "docs_api_reference_github",
  `${DOCS_REPO}/blob/main/content/docs/api-reference.mdx`,
  [200]
);

await check(
  "docs_agent_builders_github",
  `${DOCS_REPO}/blob/main/content/docs/get-started/agent-builders.mdx`,
  [200]
);

await check(
  "docs_api_reference_open_menu",
  `${DOCS_ROOT}/api-reference`,
  [200],
  async () =>
    inspectDocsOpenMenu(
      `${DOCS_ROOT}/api-reference`,
      `${DOCS_REPO}/blob/main/content/docs/api-reference.mdx`,
      `${DOCS_ROOT}/llms.mdx/docs/api-reference/content.md`
    )
);

await check(
  "docs_agent_builders_open_menu",
  `${DOCS_ROOT}/get-started/agent-builders`,
  [200],
  async () =>
    inspectDocsOpenMenu(
      `${DOCS_ROOT}/get-started/agent-builders`,
      `${DOCS_REPO}/blob/main/content/docs/get-started/agent-builders.mdx`,
      `${DOCS_ROOT}/llms.mdx/docs/get-started/agent-builders/content.md`
    )
);

await check("docs_repo_root", `${DOCS_REPO}`, [200]);
await check(
  "sdk_repo_root",
  "https://github.com/SynapseNetworkAI/Synapse-Network-Sdk",
  [200]
);

await check("gateway_health", `${API_ROOT}/health`, [200], undefined, "public health endpoint");
await check("admin_gate", `${ADMIN_ROOT}/`, [401, 403], undefined, "protected gate expected");
await check(
  "admin_api_gate",
  `${ADMIN_API_ROOT}/`,
  [401, 403],
  undefined,
  "protected gate expected"
);

const report = {
  environment: "prod",
  generatedAt: nowIso(),
  status: failed.length === 0 ? "success" : "failed",
  rootUrl: PROD_ROOT,
  docsUrl: DOCS_ROOT,
  docsRepoUrl: DOCS_REPO,
  failed: failed.map(({ name, detail }) => ({ name, detail })),
  checks,
};

writeJson(path.join(OUT_DIR, "report.json"), report);
fs.writeFileSync(path.join(OUT_DIR, "report.md"), markdownReport(report));
fs.writeFileSync(
  path.join(OUT_DIR, "trace.jsonl"),
  `${trace.map((row) => JSON.stringify(row)).join("\n")}\n`
);
writeJson(path.join(OUT_DIR, "environment-manifest.json"), {
  environment: "prod",
  rootUrl: PROD_ROOT,
  docsUrl: DOCS_ROOT,
  gatewayUrl: API_ROOT,
  adminUrl: ADMIN_ROOT,
  adminApiUrl: ADMIN_API_ROOT,
  docsRepoUrl: DOCS_REPO,
});

console.log(`Prod public docs evidence: ${OUT_DIR}`);
if (failed.length > 0) {
  console.error(
    `FATAL PROD-PUBLIC-DOCS-001: ${failed.length} checks failed. See ${path.join(
      OUT_DIR,
      "report.json"
    )}`
  );
  process.exit(1);
}
