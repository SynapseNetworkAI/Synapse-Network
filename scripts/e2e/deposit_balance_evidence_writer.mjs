import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeDepositBalanceEvidence({
  evidence,
  config,
  outDir,
  status,
}) {
  const trace =
    evidence.steps
      .map((step) =>
        JSON.stringify({ generatedAt: new Date().toISOString(), ...step })
      )
      .join("\n") + "\n";
  const traceDigest = crypto.createHash("sha256").update(trace).digest("hex");
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), trace);
  fs.writeFileSync(
    path.join(outDir, "db-evidence.json"),
    JSON.stringify(evidence.db, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "chain-evidence.json"),
    JSON.stringify(evidence.chain, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "api-evidence.json"),
    JSON.stringify(evidence.api, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "screenshot-evidence.json"),
    JSON.stringify(evidence.screenshots, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "bugfix-log.md"),
    evidence.failed.length
      ? "# Bugfix Log\n\nOpen failures remain.\n"
      : "# Bugfix Log\n\nNo bugs found in this run.\n"
  );
  const report = {
    environment: evidence.environment,
    status,
    generatedAt: evidence.generatedAt,
    runId: config.runId,
    traceDigest,
    failed: evidence.failed,
    steps: evidence.steps,
    screenshots: evidence.screenshots.map((row) => row.path),
    ownerAddress: evidence.chain.ownerAddress,
    accountId: evidence.chain.accountId,
    depositTxHash: evidence.chain.txHash,
    depositUsdc: evidence.chain.amountUsdc,
  };
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "report.md"),
    [
      "# User-front Deposit Balance E2E",
      "",
      `- Status: ${status}`,
      `- Owner: ${report.ownerAddress}`,
      `- Deposit tx: ${report.depositTxHash}`,
      `- Amount: ${report.depositUsdc} USDC`,
      `- Failed: ${report.failed.length}`,
      "",
      "## Screenshots",
      "",
      ...report.screenshots.map((item) => `- ${item}`),
      "",
      "## Steps",
      "",
      ...evidence.steps.map(
        (step) =>
          `- ${step.ok ? "PASS" : "FAIL"} ${step.name}${
            step.detail ? ` - ${step.detail}` : ""
          }`
      ),
      "",
    ].join("\n")
  );
  console.log(
    `[deposit-balance-e2e] Report: ${path.join(outDir, "report.md")}`
  );
}
