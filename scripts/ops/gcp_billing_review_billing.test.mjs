import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverBillingExportTable,
} from "./gcp_billing_review_billing.mjs";
import { BlockedError } from "./gcp_billing_review_common.mjs";

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

test("propagates blocked discovery failures instead of masking them as missing export", () => {
  assert.throws(
    () =>
      discoverBillingExportTable(
        {
          projectId: "synapse-current-project",
          env: {},
        },
        {
          listDatasets() {
            throw new BlockedError("billing_export_discovery_failed");
          },
          collectExportTableCandidates() {
            return [];
          },
        }
      ),
    /billing_export_discovery_failed/
  );
});
