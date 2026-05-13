import assert from "node:assert/strict";
import test from "node:test";

import { testApi } from "./quality_budget_check.mjs";

const {
  commentPortion,
  effectiveLines,
  hasDisableReason,
  scanJsLikeFunctions,
  scanPythonFunctions,
} = testApi();

test("effective line count ignores blank and comment-only lines", () => {
  assert.equal(
    effectiveLines(`
// comment
const value = 1

# comment
return value
`),
    2
  );
});

test("disable comments require an explicit reason", () => {
  assert.equal(
    hasDisableReason("// eslint-disable-next-line react-hooks/exhaustive-deps"),
    false
  );
  assert.equal(
    hasDisableReason(
      "// eslint-disable-next-line react-hooks/exhaustive-deps -- stable subscription lifecycle"
    ),
    true
  );
  assert.equal(hasDisableReason("# noqa: S101 - pytest assertion"), true);
});

test("disable marker detection only inspects comments", () => {
  assert.equal(
    commentPortion("const pattern = /(eslint-disable|noqa)/.test(value);"),
    ""
  );
  assert.equal(
    commentPortion(
      "const value = call(); // eslint-disable-line -- legacy API"
    ),
    "// eslint-disable-line -- legacy API"
  );
});

test("typescript function budget catches large components", () => {
  const body = Array.from(
    { length: 121 },
    (_, index) => `  const value${index} = ${index};`
  ).join("\n");
  const findings = scanJsLikeFunctions(
    "services/user-front/src/components/HugeWidget.tsx",
    `export function HugeWidget() {\n${body}\n  return value0;\n}`
  );
  assert.match(findings.join("\n"), /QUALITY-FUNCTION-LINES/);
  assert.match(findings.join("\n"), /responsibility-focused helpers/);
  assert.match(findings.join("\n"), /Do not create mechanical fragments/);
});

test("python function budget catches too many arguments", () => {
  const findings = scanPythonFunctions(
    "services/gateway/src/services/example.py",
    "def too_wide(a, b, c, d, e, f, g, h, i):\n    return a\n"
  );
  assert.match(findings.join("\n"), /QUALITY-ARGS/);
});

test("typescript complexity budget explains responsibility-based extraction", () => {
  const nested = Array.from(
    { length: 13 },
    (_, index) => `  if (value${index}) result += ${index};`
  ).join("\n");
  const findings = scanJsLikeFunctions(
    "services/user-front/src/utils/complex.ts",
    `export function complex(value0: boolean) {\n  let result = 0;\n${nested}\n  return result;\n}`
  );
  assert.match(findings.join("\n"), /QUALITY-COMPLEXITY/);
  assert.match(findings.join("\n"), /state\/policy modules/);
  assert.match(findings.join("\n"), /mechanical fragments/);
});
