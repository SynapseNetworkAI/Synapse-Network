import assert from "node:assert/strict";
import test from "node:test";

import { discoverBillingExportTable } from "./gcp_billing_review_billing.mjs";

test("only scans the current project for billing export tables", () => {
  const scannedProjects = [];

  const result = discoverBillingExportTable(
    {
      projectId: "synapse-current-project",
      env: {},
    },
    {
      listDatasets(projectId) {
        scannedProjects.push(projectId);
        return [];
      },
      collectExportTableCandidates() {
        return [];
      },
    }
  );

  assert.equal(result, null);
  assert.deepEqual(scannedProjects, ["synapse-current-project"]);
});
