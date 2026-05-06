import test from "node:test";
import assert from "node:assert/strict";

import { scanTextForServiceCreation } from "./e2e_service_creation_guard.mjs";

test("blocks api helper POST to /v1/services", () => {
  const failures = scanTextForServiceCreation(
    `
    await api("/v1/services", {
      method: "POST",
      token,
      body: payload,
    });
    `,
    "scripts/e2e/example.mjs"
  );

  assert.equal(failures[0]?.code, "E2E-SERVICE-CREATE-001");
});

test("blocks historical admin withdrawal provider prefixes", () => {
  const failures = scanTextForServiceCreation(
    `const id = "awa_provider_withdraw_20260503";`,
    "scripts/e2e/example.mjs"
  );

  assert.equal(failures[0]?.code, "E2E-SERVICE-PREFIX-001");
});

test("allows canonical provider discovery and owner listing", () => {
  const failures = scanTextForServiceCreation(
    `
    await api("/v1/services/discover?q=svc_synapse_mock_cost_1usdc");
    await api("/v1/services", { token, address });
    `,
    "scripts/e2e/example.mjs"
  );

  assert.deepEqual(failures, []);
});
