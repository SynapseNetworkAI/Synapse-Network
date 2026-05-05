import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardOverviewScreen } from "./dashboard-overview-screen";

const useDashboardSnapshotMock = vi.fn();

vi.mock("@/features/dashboard/use-dashboard-snapshot", () => ({
  useDashboardSnapshot: (...args: unknown[]) =>
    useDashboardSnapshotMock(...args),
}));

vi.mock("@/features/dashboard/dashboard-presenters", () => ({
  buildSentinelMetrics: (
    overview: { metrics?: { pendingApprovals?: number } } | null
  ) => [
    {
      label: "当前值班结论",
      value: "运行正常",
      meta: "当前没有发现需要立刻升级的系统或资金异常。",
    },
    {
      label: "平台总账差额",
      value: "0.00 USDC",
      meta: "把链上资金、客户余额、待结算款和平台收入放在一起看是否平衡；为 0 表示整体对齐。",
    },
    {
      label: "待处理审批",
      value: String(overview?.metrics?.pendingApprovals ?? 0),
      meta: "当前等待业务或风控审核的事项数量。",
      href: "/approvals",
      actionLabel: "打开审批中心",
    },
  ],
  buildDashboardFlowCards: () => [],
  buildDashboardPressureCards: () => [],
  buildDashboardFunnelCards: () => [],
  buildDashboardCapitalPulseLanes: () => [],
}));

vi.mock("@/components/admin-shell", () => ({
  AdminShell: ({
    children,
    title,
    description,
    actions,
  }: {
    children: React.ReactNode;
    title: string;
    description: string;
    actions?: React.ReactNode;
  }) =>
    React.createElement(
      "section",
      null,
      React.createElement("h1", null, title),
      React.createElement("p", null, description),
      React.createElement(
        "div",
        { "data-testid": "admin-shell-actions" },
        actions
      ),
      children
    ),
}));

vi.mock("@/components/control-plane-loading-screen", () => ({
  ControlPlaneLoadingScreen: ({
    title,
    message,
  }: {
    title: string;
    message: string;
  }) => React.createElement("div", null, `${title}:${message}`),
}));

vi.mock("@/components/console-ui", () => ({
  MessageBanner: ({ message }: { message: string }) =>
    React.createElement("div", null, message),
}));

vi.mock("@/features/dashboard/dashboard-surfaces", () => ({
  DashboardSentinelMetricsGrid: ({
    metrics,
  }: {
    metrics: Array<{
      label: string;
      value: string;
      meta: string;
      actionLabel?: string;
    }>;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "sentinel-metrics" },
      metrics.map((metric) =>
        React.createElement(
          "article",
          { key: metric.label },
          React.createElement("span", null, metric.label),
          React.createElement("span", null, metric.value),
          React.createElement("span", null, metric.meta),
          metric.actionLabel
            ? React.createElement("span", null, metric.actionLabel)
            : null
        )
      )
    ),
  DashboardDiagnosticsSurface: ({
    diagnostics,
  }: {
    diagnostics: {
      overallStatus?: string;
      actions?: Array<{ actionId: string; label: string }>;
    } | null;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "diagnostics-surface" },
      React.createElement("span", null, diagnostics?.overallStatus ?? "n/a"),
      ...(diagnostics?.actions ?? []).map((action) =>
        React.createElement("span", { key: action.actionId }, action.label)
      )
    ),
  DashboardFlowSnapshotSurface: () =>
    React.createElement("div", { "data-testid": "flow-surface" }, "flow"),
  DashboardQueuePressureSurface: () =>
    React.createElement("div", { "data-testid": "queue-surface" }, "queue"),
}));

vi.mock("@/features/finance/capital-pulse-surface", () => ({
  CapitalPulseSurface: () =>
    React.createElement("div", { "data-testid": "capital-pulse" }, "capital"),
}));

vi.mock("@chakra-ui/react", () => ({
  Button: ({ children }: { children: React.ReactNode }) =>
    React.createElement("button", null, children),
  Grid: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

describe("DashboardOverviewScreen", () => {
  beforeEach(() => {
    useDashboardSnapshotMock.mockReset();
  });

  it("renders pending approvals from the overview payload and strips the system-center diagnostics action", () => {
    useDashboardSnapshotMock.mockReturnValue({
      overview: {
        metrics: {
          pendingApprovals: 5,
          depositExceptions: 0,
          auditAlerts: 0,
          vaultLedgerDelta: "0.00",
        },
        highlights: [],
      },
      financeOverview: null,
      operationsOverview: null,
      reconciliationDetail: null,
      diagnostics: {
        overallStatus: "degraded",
        checkedAt: "2026-03-22T12:00:00Z",
        summary: "gateway degraded and reconciliation alert present",
        signals: [
          {
            signalId: "reconciliation",
            label: "Reconciliation drift",
            status: "degraded",
            value: "11.00 USDC",
            detail: "delta mismatch",
          },
          {
            signalId: "execution-failures",
            label: "Execution retries",
            status: "nominal",
            value: "0",
            detail: "healthy",
          },
        ],
        actions: [
          {
            actionId: "system-center",
            label: "Open system center",
            href: "/system",
            detail:
              "inspect gateway health, execution failures, and persisted task status for indexer, backfill, and reconciliation",
            status: "degraded",
          },
          {
            actionId: "execution-queue",
            label: "Inspect execution queue",
            href: "/execution",
            detail: "pending reviews",
            status: "nominal",
          },
        ],
      },
      diagnosticError: null,
      diagnosticsLoading: false,
      refreshDiagnostics: vi.fn(),
      bootstrapping: false,
      error: null,
    });

    const html = renderToStaticMarkup(
      React.createElement(DashboardOverviewScreen, {
        admin: {
          adminId: "adm_super",
          email: "cliff@synapse-network.ai",
          displayName: "Super Admin",
          role: "super_admin",
        },
        token: "token-demo",
      })
    );

    expect(html).toContain("待处理审批");
    expect(html).toContain("当前等待业务或风控审核的事项数量。");
    expect(html).toContain("<span>5</span>");
    expect(html).toContain("Inspect execution queue");
    expect(html).not.toContain("Open system center");
  });
});
