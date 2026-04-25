#!/usr/bin/env node
import path from "node:path";

import {
  ROOT,
  latestEvidenceDir,
  validateGcpAlertsEvidence,
} from "./gcp_alerts_evidence_check_lib.mjs";

const dir = latestEvidenceDir({
  envName: "local",
  evidenceRoot: path.join(ROOT, "output/dogfood/gcp-alerts"),
  overrideEnv: "GCP_ALERTS_LOCAL_EVIDENCE_DIR",
});

const validated = validateGcpAlertsEvidence({
  dir,
  requiredChecks: [
    "receiver-rejects-missing-token",
    "receiver-rejects-wrong-token",
    "receiver-accepts-header-token",
    "receiver-accepts-basic-auth",
    "fake-lark-card-business-context",
    "receiver-redacts-secret-like-values",
    "lark-failure-returns-502",
    "gateway-drill-disabled-by-default",
    "gateway-drill-rejects-wrong-token",
    "gateway-drill-controlled-500",
    "gateway-drill-refuses-prod",
  ],
});

console.log(`[ci:gcp-alerts-local-evidence] validated ${validated}`);
