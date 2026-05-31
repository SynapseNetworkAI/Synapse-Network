import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const component = readFileSync(
  join(root, "src/components/docs/EnvironmentConfig.tsx"),
  "utf8"
);
const shared = readFileSync(join(root, "src/lib/shared.ts"), "utf8");

assert(!component.includes('["Console"'), "summary must not render Console");
assert(
  component.includes("function EnvironmentValue"),
  "summary values must flow through the public value renderer"
);
assert(
  component.includes("target=\"_blank\""),
  "public URLs must render as clickable external links"
);
assert(
  component.includes("Configured locally"),
  "internal local config paths must be replaced with a safe public label"
);
assert(
  component.includes("Not published"),
  "reserved production addresses must be replaced with a safe public label"
);
assert(
  shared.includes("services/user-front/src/contract-config.json"),
  "fixture should still cover local internal path redaction"
);

console.log("EnvironmentConfig public address checks passed");
