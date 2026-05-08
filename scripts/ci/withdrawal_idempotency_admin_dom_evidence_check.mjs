#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const REQUIRED_ADMIN_SCREENSHOTS = [
  "withdrawal-review-modal-open.png",
  "withdrawal-review-awaiting-otp.png",
  "withdrawal-review-submitting.png",
  "withdrawal-review-submitted-terminal.png",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function latestWithdrawalEvidenceDir() {
  if (process.env.WITHDRAWAL_IDEMPOTENCY_CONCURRENCY_EVIDENCE_DIR) {
    return path.resolve(
      process.env.WITHDRAWAL_IDEMPOTENCY_CONCURRENCY_EVIDENCE_DIR
    );
  }
  const base = path.join(
    ROOT,
    "output/dogfood/withdrawal-idempotency-concurrency"
  );
  if (!fs.existsSync(base)) return "";
  return (
    fs
      .readdirSync(base)
      .map((name) => path.join(base, name))
      .filter((dir) => fs.existsSync(path.join(dir, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function latestAdminReportPath() {
  if (process.env.ADMIN_WITHDRAWAL_APPROVAL_RECONCILIATION_REPORT) {
    return path.resolve(
      process.env.ADMIN_WITHDRAWAL_APPROVAL_RECONCILIATION_REPORT
    );
  }
  const base = path.join(ROOT, "output/dogfood/admin-withdrawal-approval");
  if (!fs.existsSync(base)) return "";
  return (
    fs
      .readdirSync(base)
      .map((name) => path.join(base, name, "reconciliation-report.json"))
      .filter((filePath) => fs.existsSync(filePath))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function requireWithdrawalEvidenceBundle(dir) {
  for (const fileName of [
    "report.json",
    "db-evidence.json",
    "chain-evidence.json",
  ]) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) {
      fatal(
        "WIC-ADMIN-EVIDENCE-WITHDRAWAL-MISSING",
        filePath,
        `Withdrawal idempotency evidence is missing ${fileName}.`,
        "Run npm run e2e:withdrawal-idempotency-concurrency and its evidence gate first."
      );
    }
  }
}

function requireCompleteEvidence(kind, dbEvidence, chainEvidence) {
  const dbKey = `${kind}ApproveCompleteConcurrency`;
  const db = dbEvidence[dbKey];
  const chain = chainEvidence[dbKey];
  if (!db || !chain) {
    fatal(
      "WIC-ADMIN-EVIDENCE-COMPLETE-MISSING",
      "db-evidence.json / chain-evidence.json",
      `Missing ${dbKey} DB or chain evidence.`,
      "Rerun the withdrawal idempotency concurrency E2E."
    );
    return;
  }
  if (
    String(db.row?.status || "").toUpperCase() !== "COMPLETED" ||
    !db.row?.txHash ||
    !db.row?.ticketHash ||
    chain.consumed !== true ||
    chain.replay?.rejected !== true
  ) {
    fatal(
      "WIC-ADMIN-EVIDENCE-COMPLETE",
      "db-evidence.json / chain-evidence.json",
      `${dbKey} does not prove completed DB row, consumed ticket, and replay rejection.`,
      "Fix the complete callback, ticket consumption, or chain evidence generation."
    );
  }
  if (
    Number(db.completeIdempotentReplayCount) !== 9 ||
    Number(db.differentTxCompleteStatus) !== 409
  ) {
    fatal(
      "WIC-ADMIN-EVIDENCE-COMPLETE-IDEMPOTENCY",
      "db-evidence.json",
      `${dbKey} does not prove 9 same-tx replays and different-tx rejection.`,
      "Complete callbacks must be stable for the same txHash and reject different txHash replays."
    );
  }
  if (
    Number(db.txDedup?.dedupeRowCount) !== 1 ||
    Number(db.txDedup?.distinctTxHashCount) !== 1
  ) {
    fatal(
      "WIC-ADMIN-EVIDENCE-TX-DEDUP",
      "db-evidence.json",
      `${dbKey} tx dedupe evidence is not exactly one withdrawal+txHash row.`,
      "Ensure synapse_withdraw_tx_dedup is written and unique."
    );
  }
}

function requireAdminDomEvidence(adminReport, adminReportPath) {
  const screenshotNames = new Set(
    (adminReport.screenshots || []).map((filePath) => path.basename(filePath))
  );
  for (const name of REQUIRED_ADMIN_SCREENSHOTS) {
    if (!screenshotNames.has(name)) {
      fatal(
        "WIC-ADMIN-EVIDENCE-SCREENSHOT",
        adminReportPath,
        `Admin approval evidence missing screenshot ${name}.`,
        "Run npm run e2e:admin-withdrawal-approval after the modal/button-state changes."
      );
    }
  }
  const modalRows = Array.isArray(adminReport.dogfood?.modalDomEvidence)
    ? adminReport.dogfood.modalDomEvidence
    : [];
  for (const screenshotName of REQUIRED_ADMIN_SCREENSHOTS.map((name) =>
    name.replace(/\.png$/, "")
  )) {
    const row = modalRows.find(
      (item) => item.screenshotName === screenshotName
    );
    if (!row) {
      fatal(
        "WIC-ADMIN-EVIDENCE-DOM-MISSING",
        adminReportPath,
        `Admin approval evidence missing modal DOM metadata for ${screenshotName}.`,
        "The dogfood report must bind each screenshot to role/dialog, text, and button-state metadata."
      );
      continue;
    }
    if (
      row.role !== "dialog" ||
      row.ariaModal !== "true" ||
      row.drawerCount !== 0 ||
      row.centered !== true ||
      !String(row.actualDialogText || "").includes(adminReport.withdrawalId)
    ) {
      fatal(
        "WIC-ADMIN-EVIDENCE-DOM",
        adminReportPath,
        `${screenshotName} is not proven as a centered modal for the same withdrawalId.`,
        "Fix Admin-front modal rendering or dogfood DOM evidence."
      );
    }
    if (screenshotName !== "withdrawal-review-modal-open") {
      const buttonStates = Array.isArray(row.buttonStates)
        ? row.buttonStates
        : [];
      if (
        !buttonStates.some(
          (item) => item.name === "approve" && item.disabled === true
        )
      ) {
        fatal(
          "WIC-ADMIN-EVIDENCE-BUTTON",
          adminReportPath,
          `${screenshotName} does not prove the approve button is disabled.`,
          "The approval flow must prove awaiting/submitting/submitted states cannot be double-clicked."
        );
      }
    }
  }
}

const withdrawalDir = latestWithdrawalEvidenceDir();
if (!withdrawalDir) {
  fatal(
    "WIC-ADMIN-EVIDENCE-001",
    "",
    "No withdrawal idempotency concurrency evidence directory was found.",
    "Run npm run e2e:withdrawal-idempotency-concurrency."
  );
}
const adminReportPath = latestAdminReportPath();
if (!adminReportPath) {
  fatal(
    "WIC-ADMIN-EVIDENCE-002",
    "",
    "No admin withdrawal approval reconciliation report was found.",
    "Run npm run e2e:admin-withdrawal-approval."
  );
}
if (process.exitCode) process.exit(process.exitCode);

requireWithdrawalEvidenceBundle(withdrawalDir);
if (process.exitCode) process.exit(process.exitCode);

const withdrawalReport = readJson(path.join(withdrawalDir, "report.json"));
const dbEvidence = readJson(path.join(withdrawalDir, "db-evidence.json"));
const chainEvidence = readJson(path.join(withdrawalDir, "chain-evidence.json"));
const adminReport = readJson(adminReportPath);

if (
  withdrawalReport.status !== "success" ||
  !Array.isArray(withdrawalReport.failed) ||
  withdrawalReport.failed.length !== 0
) {
  fatal(
    "WIC-ADMIN-EVIDENCE-WITHDRAWAL-FAILED",
    path.join(withdrawalDir, "report.json"),
    "Withdrawal idempotency concurrency report is not green.",
    "Fix and rerun npm run e2e:withdrawal-idempotency-concurrency."
  );
}
if (
  adminReport.status !== "success" ||
  !Array.isArray(adminReport.failed) ||
  adminReport.failed.length !== 0
) {
  fatal(
    "WIC-ADMIN-EVIDENCE-ADMIN-FAILED",
    adminReportPath,
    "Admin withdrawal approval reconciliation report is not green.",
    "Fix and rerun npm run e2e:admin-withdrawal-approval."
  );
}

requireCompleteEvidence("consumer", dbEvidence, chainEvidence);
requireCompleteEvidence("provider", dbEvidence, chainEvidence);
requireAdminDomEvidence(adminReport, adminReportPath);

if (
  String(
    adminReport.db?.afterCompleteWithdrawal?.status || ""
  ).toUpperCase() !== "COMPLETED" ||
  !adminReport.db?.afterCompleteWithdrawal?.txHash ||
  !adminReport.db?.afterCompleteWithdrawal?.ticketHash ||
  adminReport.db?.afterClaimBalance?.pendingBalance !== "0.000000" ||
  adminReport.db?.afterClaimBalance?.frozenBalance !== "0.000000"
) {
  fatal(
    "WIC-ADMIN-EVIDENCE-ADMIN-DB",
    adminReportPath,
    "Admin approval DB evidence does not prove completed withdrawal, txHash/ticketHash, and zero locked balance.",
    "Rerun the admin approval E2E and inspect Gateway DB finalization."
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(
  `[withdrawal-idempotency-admin-dom-evidence] passed: ${withdrawalDir}`
);
console.log(
  `[withdrawal-idempotency-admin-dom-evidence] admin=${adminReportPath}`
);
