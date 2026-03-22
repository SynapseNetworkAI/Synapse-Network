import { describe, expect, it } from "vitest";

import { buildDiagnosticActionCards, buildDiagnosticSignalCards, buildPrioritizedDiagnosticSignalCards, getDiagnosticDetailText, getDiagnosticLabelText, getDiagnosticStatusLabel, getDiagnosticSummaryText, getDiagnosticTone } from "./diagnostic-presenters";

describe("diagnostic-presenters", () => {
  it("maps diagnostics tones", () => {
    expect(getDiagnosticTone("nominal")).toBe("green");
    expect(getDiagnosticTone("monitoring")).toBe("orange");
    expect(getDiagnosticTone("degraded")).toBe("red");
    expect(getDiagnosticTone(undefined)).toBe("gray");
  });

  it("maps diagnostics statuses to business-friendly Chinese labels", () => {
    expect(getDiagnosticStatusLabel("nominal")).toBe("运行正常");
    expect(getDiagnosticStatusLabel("monitoring")).toBe("需要关注");
    expect(getDiagnosticStatusLabel("degraded")).toBe("尽快处理");
    expect(getDiagnosticStatusLabel("pending")).toBe("待确认");
    expect(getDiagnosticStatusLabel(undefined)).toBe("待确认");
  });

  it("rewrites backend english summaries into business-friendly Chinese", () => {
    expect(getDiagnosticSummaryText("gateway degraded and reconciliation alert present")).toBe(
      "当前网关运行存在异常，且对账已触发提醒，建议优先排查系统状态和资金差异。",
    );
    expect(getDiagnosticSummaryText("reconciliation alert present")).toBe(
      "当前对账已出现提醒，建议优先核对账面记录与链上资金是否一致。",
    );
    expect(getDiagnosticSummaryText("已是中文摘要")).toBe("已是中文摘要");
  });

  it("rewrites backend english detail text into business-friendly Chinese", () => {
    expect(getDiagnosticDetailText("delta mismatch")).toBe("账面记录和实际资金不一致，需要进一步核对。");
    expect(getDiagnosticDetailText("inspect runtime state")).toBe("建议进入系统状态页查看当前运行情况。");
    expect(getDiagnosticDetailText("pending reviews")).toBe("当前还有事项等待人工审核，请关注处理进度。");
    expect(getDiagnosticDetailText("已是中文说明")).toBe("已是中文说明");
  });

  it("rewrites backend english labels into business-friendly Chinese", () => {
    expect(getDiagnosticLabelText("Reconciliation drift")).toBe("对账差异");
    expect(getDiagnosticLabelText("Open system center")).toBe("打开系统状态页");
    expect(getDiagnosticLabelText("Gateway runtime")).toBe("网关运行状态");
    expect(getDiagnosticLabelText("已是中文标题")).toBe("已是中文标题");
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
        label: "对账差异",
        value: "12.00 USDC",
        detail: "账面记录和实际资金不一致，需要进一步核对。",
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
        label: "打开系统状态页",
        href: "/system",
        detail: "建议进入系统状态页查看当前运行情况。",
        status: "monitoring",
        tone: "orange",
      },
    ]);
  });

  it("prioritizes degraded signals ahead of monitoring and nominal ones", () => {
    const cards = buildPrioritizedDiagnosticSignalCards([
      {
        signalId: "queue",
        label: "Approval queue",
        status: "monitoring",
        value: "3",
        detail: "pending reviews",
      },
      {
        signalId: "gateway",
        label: "Gateway runtime",
        status: "degraded",
        value: "down",
        detail: "heartbeat lost",
      },
      {
        signalId: "audit",
        label: "Audit stream",
        status: "nominal",
        value: "ok",
        detail: "healthy",
      },
    ], 2);

    expect(cards.map((card) => card.key)).toEqual(["gateway", "queue"]);
  });
});