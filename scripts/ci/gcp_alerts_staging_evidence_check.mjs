#!/usr/bin/env node
import path from "node:path";

import {
  ROOT,
  latestEvidenceDir,
  validateGcpAlertsEvidence,
} from "./gcp_alerts_evidence_check_lib.mjs";

const dir = latestEvidenceDir({
  envName: "staging",
  evidenceRoot: path.join(ROOT, "docs/evidence/staging/gcp-alerts"),
  overrideEnv: "GCP_ALERTS_STAGING_EVIDENCE_DIR",
});

const validated = validateGcpAlertsEvidence({
  dir,
  requiredChecks: ["gcp-alert-receiver-synthetic-lark"],
  optionalPassedChecks: ["gateway-controlled-500-drill"],
  requireMonitoringDelivery: process.env.GCP_ALERTS_REQUIRE_MONITORING_DELIVERY === "true",
});

console.log(`[ci:gcp-alerts-staging-evidence] validated ${validated}`);
