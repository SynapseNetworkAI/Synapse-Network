import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const component = readFileSync(
  resolve(root, "src/components/docs/EnvironmentConfig.tsx"),
  "utf8"
);
const shared = readFileSync(resolve(root, "src/lib/shared.ts"), "utf8");

assert.equal(
  component.includes('["Console"'),
  false,
  "Environment summary must not expose Console URLs"
);
assert.match(
  component,
  /function EnvironmentValue/,
  "Environment summary URLs should render through link-aware EnvironmentValue"
);
assert.match(
  component,
  /target="_blank"/,
  "Public environment URLs should be clickable external links"
);
assert.match(
  component,
  /Configured locally/,
  "Internal local config paths should be redacted"
);
assert.match(
  component,
  /Not published/,
  "Reserved production placeholders should be redacted"
);
assert.equal(
  shared.includes("services/user-front/src/contract-config.json"),
  true,
  "Test fixture should cover local internal path redaction"
);

console.log("EnvironmentConfig public address checks passed");
