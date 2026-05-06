#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE = path.join(
  ROOT,
  "output/dogfood/consumer-withdraw-claim-fullchain"
);

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestReportDir() {
  if (process.env.CONSUMER_WITHDRAW_CLAIM_FULLCHAIN_EVIDENCE_DIR) {
    return path.resolve(
      process.env.CONSUMER_WITHDRAW_CLAIM_FULLCHAIN_EVIDENCE_DIR
    );
  }
  if (!fs.existsSync(BASE)) return "";
  return (
    fs
      .readdirSync(BASE)
      .map((name) => path.join(BASE, name))
      .filter((dir) => fs.existsSync(path.join(dir, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function big(value) {
  return BigInt(String(value || "0"));
}

function hasSecretLeak(text) {
  const patterns = [
    ["JWT", /eyJ[A-Za-z0-9._~+/=-]{20,}/],
    ["AUTHORIZATION", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    [
      "SENSITIVE_FIELD_VALUE",
      /"(?:[^"]*(?:privateKey|private_key|signature|authorization|token|secret|password)[^"]*)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    ],
    [
      "SENSITIVE_ENV_NAME",
      /\b(?:PRIVATE_KEY|PRIVATEKEY|JWT_SECRET|AUTH_SECRET|ADMIN_TOTP_SECRET|ADMIN_PASSWORD)\b/,
    ],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

const dir = latestReportDir();
if (!dir) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-001",
    "",
    "No consumer withdraw fullchain local evidence directory was found.",
    "Run npm run e2e:consumer-withdraw-claim-fullchain:local first."
  );
}

if (process.exitCode) process.exit(process.exitCode);

const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
  "dom-evidence.json",
  "screenshot-evidence.json",
];

for (const name of requiredFiles) {
  if (!fs.existsSync(path.join(dir, name))) {
    fatal(
      "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-002",
      path.join(dir, name),
      "Required evidence file is missing.",
      "Rerun the full local E2E and do not hand-edit partial evidence directories."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const apiEvidence = readJson(path.join(dir, "api-evidence.json"));
const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const chainEvidence = readJson(path.join(dir, "chain-evidence.json"));
const screenshotEvidence = readJson(path.join(dir, "screenshot-evidence.json"));
const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
const traceText = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");
const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");
const allEvidenceText = requiredFiles
  .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
  .join("\n");

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length !== 0
) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-003",
    path.join(dir, "report.json"),
    `E2E report status is ${report.status}; failures=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "Fix the failure, keep bugfix-log.md, and rerun the E2E."
  );
}

if (!report.traceDigest || report.traceDigest !== traceDigest) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-004",
    path.join(dir, "report.json"),
    "report.json traceDigest does not match trace.jsonl.",
    "Do not hand-edit evidence; rerun the E2E."
  );
}

if (/Status:\s*open/i.test(bugfixLog)) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-005",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log.md still contains an open bug.",
    "Fix the bug, mark it closed, and rerun the E2E."
  );
}

const created = dbEvidence.afterCreate?.row;
const approved = dbEvidence.afterApprove?.row;
const completed = dbEvidence.afterComplete?.row;
if (!created || !approved || !completed) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-006",
    path.join(dir, "db-evidence.json"),
    "DB evidence is missing create/approve/complete snapshots.",
    "Record all three lifecycle stages in db-evidence.json."
  );
}

if ((created?.status || "").toUpperCase() !== "PENDING_MANUAL_REVIEW") {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-007",
    path.join(dir, "db-evidence.json"),
    `Create stage status is ${created?.status}, not PENDING_MANUAL_REVIEW.`,
    "Fix manual-review creation state before merging."
  );
}

if ((approved?.status || "").toUpperCase() !== "REQUESTED") {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-008",
    path.join(dir, "db-evidence.json"),
    `Approve stage status is ${approved?.status}, not REQUESTED.`,
    "Fix admin approval so it transitions frozen funds into a signed ticket-ready REQUESTED state."
  );
}

if ((completed?.status || "").toUpperCase() !== "COMPLETED") {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-009",
    path.join(dir, "db-evidence.json"),
    `Complete stage status is ${completed?.status}, not COMPLETED.`,
    "Fix complete callback / watcher completion semantics."
  );
}

const approvedApiRow = apiEvidence.afterApprove;
if (
  (approvedApiRow?.status || "").toUpperCase() !== "REQUESTED" ||
  approvedApiRow?.claimable !== true ||
  !approvedApiRow?.ticket ||
  approvedApiRow?.txHash
) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-010",
    path.join(dir, "api-evidence.json"),
    "Approved API row does not prove claimable REQUESTED ticket-ready state.",
    "Return status=REQUESTED, claimable=true, ticket present, txHash empty after manual approval."
  );
}

const completedApiRow = apiEvidence.afterComplete;
if (
  (completedApiRow?.status || "").toUpperCase() !== "COMPLETED" ||
  completedApiRow?.claimable !== false ||
  !completedApiRow?.txHash
) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-011",
    path.join(dir, "api-evidence.json"),
    "Completed API row does not prove final settled state.",
    "Ensure complete/watcher returns COMPLETED, claimable=false, and txHash present."
  );
}

const claimEvidence = chainEvidence.afterClaim;
if (!claimEvidence?.before || !claimEvidence?.after || !claimEvidence?.claim) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-012",
    path.join(dir, "chain-evidence.json"),
    "Chain evidence missing claim before/after snapshots.",
    "Capture wallet, vault, and platformFeePool snapshots around the real user claim."
  );
}

const netDelta = big(claimEvidence.netDeltaAtomic);
const vaultDelta = big(claimEvidence.vaultDeltaAtomic);
const feePoolDelta = big(claimEvidence.feePoolDeltaAtomic);
const ticketAmount = big(approvedApiRow.ticket?.amount || 0);
const ticketFee = big(approvedApiRow.ticket?.fee || 0);

if (netDelta !== ticketAmount) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-013",
    path.join(dir, "chain-evidence.json"),
    `User wallet delta ${netDelta} does not equal ticket amount ${ticketAmount}.`,
    "Fix claim settlement or use the signed ticket amount as the expected user delta."
  );
}

if (vaultDelta !== -ticketAmount) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-014",
    path.join(dir, "chain-evidence.json"),
    `Vault delta ${vaultDelta} does not equal -ticket amount ${ticketAmount}.`,
    "Vault balance after claim must decrease by the net amount paid to the user."
  );
}

if (feePoolDelta !== ticketFee) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-015",
    path.join(dir, "chain-evidence.json"),
    `platformFeePool delta ${feePoolDelta} does not equal ticket fee ${ticketFee}.`,
    "Fee pool must only increase by the signed withdrawal fee."
  );
}

const platformEvidence = chainEvidence.platformFeeWithdrawal;
if (
  !platformEvidence?.before ||
  !platformEvidence?.after ||
  !platformEvidence?.tx
) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-016",
    path.join(dir, "chain-evidence.json"),
    "Platform fee withdrawal evidence is incomplete.",
    "Capture owner wallet, vault, and platformFeePool snapshots around withdrawPlatformFees."
  );
}

const platformWalletDelta = big(platformEvidence.walletDeltaAtomic);
const platformVaultDelta = big(platformEvidence.vaultDeltaAtomic);
const platformPoolDelta = big(platformEvidence.poolDeltaAtomic);
if (platformWalletDelta !== ticketFee) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-017",
    path.join(dir, "chain-evidence.json"),
    `Platform wallet delta ${platformWalletDelta} does not equal fee ${ticketFee}.`,
    "Platform wallet should receive only the accrued fee."
  );
}

if (platformPoolDelta !== -ticketFee) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-018",
    path.join(dir, "chain-evidence.json"),
    `Platform fee pool delta ${platformPoolDelta} does not equal -fee ${ticketFee}.`,
    "withdrawPlatformFees must consume exactly the accrued platformFeePool amount."
  );
}

if (platformVaultDelta !== -ticketFee) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-019",
    path.join(dir, "chain-evidence.json"),
    `Vault delta after platform withdrawal ${platformVaultDelta} does not equal -fee ${ticketFee}.`,
    "Vault must lose only the fee when platform revenue is withdrawn."
  );
}

if (chainEvidence.platformFeeOverdraw?.rejected !== true) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-020",
    path.join(dir, "chain-evidence.json"),
    "Missing overdraw-revert evidence for withdrawPlatformFees.",
    "Attempt amount > platformFeePool and prove the contract rejects it."
  );
}

const requiredScreenshots = [
  "01-credits-under-review.png",
  "02-withdrawal-review-list.png",
  "03-withdrawal-review-detail.png",
  "03-credits-ready-to-claim.png",
  "04-payments-ready-to-claim.png",
  "05-approve-success.png",
  "05-credits-completed.png",
  "06-review-history.png",
  "06-payments-completed.png",
];

for (const name of requiredScreenshots) {
  const filePath = path.join(dir, "screenshots", name);
  if (!fs.existsSync(filePath)) {
    fatal(
      "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-021",
      filePath,
      `Required screenshot is missing: ${name}`,
      "Rerun the E2E and do not prune screenshots from the evidence directory."
    );
  }
  const metadata = screenshotEvidence.find((item) =>
    String(item.file || "").endsWith(name)
  );
  if (
    !metadata ||
    metadata.forbiddenTextAbsent !== true ||
    !metadata.domCheckpoint ||
    !metadata.apiCheckpoint ||
    !metadata.dbCheckpoint
  ) {
    fatal(
      "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-022",
      path.join(dir, "screenshot-evidence.json"),
      `Screenshot ${name} lacks DOM/API/DB checkpoint metadata.`,
      "Capture screenshots only after DOM, API, and DB checkpoints pass."
    );
  }
}

const combinedScreenshots = JSON.stringify(screenshotEvidence);
for (const forbidden of [
  "处理中",
  "Internal server error",
  "Unauthorized",
  "Loading",
]) {
  if (forbidden === "处理中") {
    const readyShot = screenshotEvidence.find((item) =>
      String(item.file || "").endsWith("04-payments-ready-to-claim.png")
    );
    if (readyShot?.expectedText?.includes("处理中")) {
      fatal(
        "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-023",
        path.join(dir, "screenshot-evidence.json"),
        "Ready-to-claim screenshot metadata still expects generic processing text.",
        "Ticket-ready consumer withdrawals must render as claimable, not as generic processing."
      );
    }
  } else if (combinedScreenshots.includes(forbidden)) {
    fatal(
      "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-024",
      path.join(dir, "screenshot-evidence.json"),
      `Forbidden text leaked into screenshot evidence metadata: ${forbidden}`,
      "Do not accept screenshots of error, auth, or loading states."
    );
  }
}

const leaks = hasSecretLeak(allEvidenceText);
if (leaks.length > 0) {
  fatal(
    "CONSUMER-WITHDRAW-FULLCHAIN-EVIDENCE-025",
    dir,
    `Evidence appears to contain secret-like values: ${leaks.join(", ")}.`,
    "Redact tokens, signatures, passwords, and private material from the runner, then regenerate evidence."
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:consumer-withdraw-claim-fullchain] evidence ok: ${dir}`);
