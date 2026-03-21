import { describe, expect, it } from "vitest";

import { buildDiagnosticActionCards, buildDiagnosticSignalCards, getDiagnosticTone } from "./diagnostic-presenters";

describe("diagnostic-presenters", () => {
  it("maps diagnostics tones", () => {
    expect(getDiagnosticTone("nominal")).toBe("green");
    expect(getDiagnosticTone("monitoring")).toBe("orange");
    expect(getDiagnosticTone("degraded")).toBe("red");
    expect(getDiagnosticTone(undefined)).toBe("gray");
  });

  it("builds diagnostic signal cards with resolved tones", () => {
    expect(buildDiagnosticSignalCards([
      {
        signalId: "reconciliation",
        label: "Reconciliation drift",
        status: "degraded",
        value: "12.00 USDC",
        detail: "delta mismatch",
      },
    ])).toEqual([
      {
        key: "reconciliation",
        label: "Reconciliation drift",
        value: "12.00 USDC",
        detail: "delta mismatch",
        status: "degraded",
        tone: "red",
      },
    ]);
  });

  it("builds diagnostic action cards with resolved tones", () => {
    expect(buildDiagnosticActionCards([
      {
        actionId: "system-center",
        label: "Open system center",
        href: "/system",
        detail: "inspect runtime state",
        status: "monitoring",
      },
    ])).toEqual([
      {
        key: "system-center",
        label: "Open system center",
        href: "/system",
        detail: "inspect runtime state",
        status: "monitoring",
        tone: "orange",
      },
    ]);
  });
});