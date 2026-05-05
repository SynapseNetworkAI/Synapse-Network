import { describe, expect, it } from "vitest";

import {
  buildAdminNavigation,
  filterNavigation,
  findNavItemByPath,
  findNavPathByPath,
  getNavVisual,
  resolveExpandedNavigationIds,
} from "./navigation";

function createMenuItem(
  overrides: Partial<{
    itemId: string;
    sectionId: string;
    sectionLabel: string;
    sectionDescription: string;
    label: string;
    href: string | null;
    description: string;
    parentItemId: string | null;
    nodeType: "category" | "page" | "panel";
    iconKey: string;
    requiredRoles: string[];
    requiredPermissions: string[];
    sortOrder: number;
    keywords: string[];
  }> = {}
) {
  return {
    itemId: "dashboard",
    sectionId: "control-overview",
    sectionLabel: "控制总览",
    sectionDescription: "总览、执行态与系统健康。",
    label: "控制台",
    href: null,
    description: "overview",
    parentItemId: null,
    nodeType: "category" as const,
    iconKey: "OV",
    requiredRoles: [],
    requiredPermissions: [],
    sortOrder: 10,
    keywords: [],
    ...overrides,
  };
}

describe("buildAdminNavigation", () => {
  it("builds a tree from backend parent-child metadata", () => {
    const navigation = buildAdminNavigation([
      createMenuItem({
        itemId: "control-overview",
        label: "控制总览",
        href: null,
        nodeType: "category",
        iconKey: "CT",
      }),
      createMenuItem({
        itemId: "dashboard",
        parentItemId: "control-overview",
        href: null,
        nodeType: "category",
      }),
      createMenuItem({
        itemId: "dashboard-runtime",
        label: "运行态",
        href: "/dashboard/runtime",
        parentItemId: "dashboard",
        nodeType: "page",
        iconKey: "02",
        sortOrder: 11,
      }),
      createMenuItem({
        itemId: "business-control",
        sectionId: "ops-controls",
        sectionLabel: "业务控制",
        sectionDescription: "审批、资金与风险联动控制台。",
        label: "业务控制",
        href: null,
        nodeType: "category",
        iconKey: "BC",
        sortOrder: 20,
      }),
      createMenuItem({
        itemId: "finance",
        sectionId: "ops-controls",
        sectionLabel: "业务控制",
        sectionDescription: "审批、资金与风险联动控制台。",
        label: "Finance",
        href: "/finance",
        description: "capital desk",
        parentItemId: "business-control",
        iconKey: "FN",
        sortOrder: 21,
      }),
    ]);

    expect(navigation.map((section) => section.id)).toEqual([
      "control-overview",
      "business-control",
    ]);
    expect(navigation[0]?.children?.[0]?.id).toBe("dashboard");
    expect(
      navigation[0]?.children?.[0]?.children?.map((item) => item.id)
    ).toEqual(["dashboard-runtime"]);
    expect(navigation[0]?.children?.[0]?.children?.[0]?.path).toBe(
      "/dashboard/runtime"
    );
    expect(navigation[1]?.children?.[0]?.id).toBe("finance");
  });

  it("does not make category nodes navigable even when the backend sends an href", () => {
    const navigation = buildAdminNavigation([
      createMenuItem({
        itemId: "dashboard",
        href: "/dashboard/overview",
        nodeType: "category",
      }),
      createMenuItem({
        itemId: "dashboard-overview",
        label: "概览",
        href: "/dashboard/overview",
        parentItemId: "dashboard",
        nodeType: "page",
        iconKey: "01",
      }),
    ]);

    expect(navigation[0]?.path).toBeUndefined();
    expect(navigation[0]?.children?.[0]?.path).toBe("/dashboard/overview");
  });

  it("recovers known dashboard page routes when backend node types drift", () => {
    const navigation = buildAdminNavigation([
      createMenuItem({
        itemId: "control-overview",
        label: "控制总览",
        href: null,
        nodeType: "category",
        iconKey: "CT",
      }),
      createMenuItem({
        itemId: "dashboard",
        label: "控制台",
        href: "/dashboard/overview",
        parentItemId: "control-overview",
        nodeType: "category",
      }),
      createMenuItem({
        itemId: "dashboard-overview",
        label: "概览",
        href: null,
        parentItemId: "dashboard",
        nodeType: "panel",
        iconKey: "01",
        sortOrder: 11,
      }),
      createMenuItem({
        itemId: "dashboard-runtime",
        label: "运行态",
        href: null,
        parentItemId: "dashboard",
        nodeType: "panel",
        iconKey: "02",
        sortOrder: 12,
      }),
    ]);

    const dashboard = navigation[0]?.children?.[0];

    expect(dashboard?.path).toBeUndefined();
    expect(dashboard?.children?.map((item) => [item.id, item.path])).toEqual([
      ["dashboard-overview", "/dashboard/overview"],
      ["dashboard-runtime", "/dashboard/runtime"],
    ]);
  });

  it("falls back to the other-modules bucket for orphan items", () => {
    const navigation = buildAdminNavigation([
      createMenuItem({
        itemId: "custom-module",
        sectionId: "custom",
        sectionLabel: "Custom",
        sectionDescription: "custom",
        label: "Custom",
        href: "/custom",
        description: "custom module",
        parentItemId: "missing-parent",
        sortOrder: 1,
      }),
    ]);

    expect(navigation).toHaveLength(1);
    expect(navigation[0]?.id).toBe("other-modules");
  });

  it("builds the Analytics category with all drilldown pages", () => {
    const navigation = buildAdminNavigation([
      createMenuItem({
        itemId: "control-overview",
        label: "控制总览",
        href: null,
        nodeType: "category",
        iconKey: "CT",
      }),
      createMenuItem({
        itemId: "dashboard",
        parentItemId: "control-overview",
        href: null,
        nodeType: "category",
      }),
      createMenuItem({
        itemId: "analytics",
        label: "Analytics",
        href: null,
        description: "增长、收入、风控与埋点质量观测。",
        parentItemId: "dashboard",
        nodeType: "category",
        iconKey: "AN",
        sortOrder: 20,
        keywords: [
          "analytics",
          "events",
          "clickhouse",
          "growth",
          "revenue",
          "risk",
          "quality",
        ],
      }),
      createMenuItem({
        itemId: "dashboard-analytics",
        label: "Analytics 总览",
        href: "/dashboard/analytics",
        parentItemId: "analytics",
        nodeType: "page",
        iconKey: "A0",
        sortOrder: 21,
      }),
      createMenuItem({
        itemId: "analytics-consumer-funnel",
        label: "Consumer 激活漏斗",
        href: "/dashboard/analytics/consumer-funnel",
        parentItemId: "analytics",
        nodeType: "page",
        iconKey: "AF",
        sortOrder: 22,
        keywords: ["analytics", "funnel", "growth"],
      }),
      createMenuItem({
        itemId: "analytics-invocation-revenue",
        label: "调用与收入",
        href: "/dashboard/analytics/invocation-revenue",
        parentItemId: "analytics",
        nodeType: "page",
        iconKey: "AI",
        sortOrder: 23,
        keywords: ["analytics", "revenue"],
      }),
    ]);

    const analytics = navigation[0]?.children?.[0]?.children?.[0];
    expect(analytics?.id).toBe("analytics");
    expect(analytics?.path).toBeUndefined();
    expect(analytics?.children?.map((item) => item.id)).toEqual([
      "dashboard-analytics",
      "analytics-consumer-funnel",
      "analytics-invocation-revenue",
    ]);
    expect(
      findNavItemByPath(navigation, "/dashboard/analytics/consumer-funnel")?.id
    ).toBe("analytics-consumer-funnel");
    expect(filterNavigation(navigation, "invocation").expandedIds).toContain(
      "analytics"
    );
  });
});

describe("getNavVisual", () => {
  it("returns the Sentinel metadata for known items", () => {
    expect(getNavVisual("dashboard")).toEqual({
      icon: "DA",
      kicker: "总览与业务运行态入口。",
    });
  });

  it("returns a generic fallback for unknown items", () => {
    expect(getNavVisual("unknown")).toEqual({
      icon: "SN",
      kicker: "control module",
    });
  });
});

describe("navigation tree helpers", () => {
  const navigation = buildAdminNavigation([
    createMenuItem({
      itemId: "control-overview",
      sectionId: "control-overview",
      sectionLabel: "控制总览",
      sectionDescription: "总览、执行态与系统健康。",
      label: "控制总览",
      href: null,
      nodeType: "category",
      iconKey: "CT",
      sortOrder: 5,
    }),
    createMenuItem({
      itemId: "dashboard",
      sectionId: "control-overview",
      sectionLabel: "控制总览",
      sectionDescription: "总览、执行态与系统健康。",
      label: "Dashboard",
      href: null,
      description: "overview",
      parentItemId: "control-overview",
      nodeType: "category",
      iconKey: "OV",
      sortOrder: 10,
    }),
    createMenuItem({
      itemId: "dashboard-overview",
      sectionId: "control-overview",
      sectionLabel: "控制总览",
      sectionDescription: "总览、执行态与系统健康。",
      label: "概览",
      href: "/dashboard/overview",
      description: "overview summary",
      parentItemId: "dashboard",
      nodeType: "page",
      iconKey: "01",
      sortOrder: 11,
    }),
    createMenuItem({
      itemId: "identity-access",
      sectionId: "identity-access",
      sectionLabel: "身份与权限",
      sectionDescription: "后台用户、角色策略与导航治理。",
      label: "身份与权限",
      href: null,
      nodeType: "category",
      iconKey: "IA",
      sortOrder: 10,
    }),
    createMenuItem({
      itemId: "role-permissions",
      sectionId: "identity-access",
      sectionLabel: "身份与权限",
      sectionDescription: "后台用户、角色策略与导航治理。",
      label: "Role Permissions",
      href: "/role-permissions",
      description: "matrix",
      parentItemId: "identity-access",
      nodeType: "page",
      iconKey: "RB",
      sortOrder: 20,
    }),
    createMenuItem({
      itemId: "permissions-matrix",
      sectionId: "identity-access",
      sectionLabel: "身份与权限",
      sectionDescription: "后台用户、角色策略与导航治理。",
      label: "权限矩阵",
      href: "/role-permissions#permissions-matrix",
      description: "permission matrix",
      parentItemId: "role-permissions",
      nodeType: "panel",
      iconKey: "PM",
      sortOrder: 21,
    }),
    createMenuItem({
      itemId: "module-boundaries",
      sectionId: "identity-access",
      sectionLabel: "身份与权限",
      sectionDescription: "后台用户、角色策略与导航治理。",
      label: "模块边界",
      href: "/role-permissions#module-boundaries",
      description: "module boundaries",
      parentItemId: "role-permissions",
      nodeType: "panel",
      iconKey: "MB",
      sortOrder: 22,
    }),
    createMenuItem({
      itemId: "reviewer-split",
      sectionId: "identity-access",
      sectionLabel: "身份与权限",
      sectionDescription: "后台用户、角色策略与导航治理。",
      label: "Reviewer 分工",
      href: "/role-permissions#reviewer-split",
      description: "reviewer responsibility",
      parentItemId: "role-permissions",
      nodeType: "panel",
      iconKey: "RV",
      sortOrder: 23,
    }),
  ]);

  it("returns the active path chain for a page", () => {
    expect(findNavPathByPath(navigation, "/role-permissions")).toEqual([
      "identity-access",
      "role-permissions",
    ]);
  });

  it("maps role permission panel nodes to page anchors", () => {
    const rolePermissions = findNavItemByPath(navigation, "/role-permissions");

    expect(
      rolePermissions?.children?.map((item) => [item.id, item.path])
    ).toEqual([
      ["permissions-matrix", "/role-permissions#permissions-matrix"],
      ["module-boundaries", "/role-permissions#module-boundaries"],
      ["reviewer-split", "/role-permissions#reviewer-split"],
    ]);
    expect(
      findNavItemByPath(navigation, "/role-permissions#permissions-matrix")?.id
    ).toBe("permissions-matrix");
    expect(
      findNavItemByPath(navigation, "/role-permissions#module-boundaries")?.id
    ).toBe("module-boundaries");
    expect(
      findNavItemByPath(navigation, "/role-permissions#reviewer-split")?.id
    ).toBe("reviewer-split");
  });

  it("finds the active leaf item for a dashboard child page", () => {
    expect(findNavItemByPath(navigation, "/dashboard/overview")?.id).toBe(
      "dashboard-overview"
    );
  });

  it("filters legacy health child items out of the dashboard navigation", () => {
    const mappedNavigation = buildAdminNavigation([
      createMenuItem({
        itemId: "control-overview",
        sectionId: "control-overview",
        sectionLabel: "控制总览",
        sectionDescription: "总览、执行态与系统健康。",
        label: "控制总览",
        href: null,
        nodeType: "category",
        iconKey: "CT",
        sortOrder: 5,
      }),
      createMenuItem({
        itemId: "dashboard",
        sectionId: "control-overview",
        sectionLabel: "控制总览",
        sectionDescription: "总览、执行态与系统健康。",
        label: "Dashboard",
        href: null,
        description: "overview",
        parentItemId: "control-overview",
        nodeType: "category",
        iconKey: "OV",
        sortOrder: 10,
      }),
      createMenuItem({
        itemId: "dashboard-system-health",
        sectionId: "control-overview",
        sectionLabel: "控制总览",
        sectionDescription: "总览、执行态与系统健康。",
        label: "系统健康",
        href: null,
        description: "health",
        parentItemId: "dashboard",
        nodeType: "panel",
        iconKey: "03",
        sortOrder: 12,
      }),
    ]);

    expect(mappedNavigation[0]?.children?.[0]?.children ?? []).toHaveLength(0);
    expect(findNavItemByPath(mappedNavigation, "/system")).toBeNull();
  });

  it("filters nested nodes and expands their ancestors", () => {
    const result = filterNavigation(navigation, "reviewer");

    expect(result.filtered[0]?.id).toBe("identity-access");
    expect(result.expandedIds).toContain("identity-access");
    expect(result.expandedIds).toContain("role-permissions");
  });

  it("allows an active parent node to be manually collapsed", () => {
    const expandedIds = resolveExpandedNavigationIds({
      manualExpandedIds: [],
      manualCollapsedIds: ["control-overview"],
      activePath: ["control-overview", "dashboard", "dashboard-overview"],
      filteredExpandedIds: [],
      query: "",
    });

    expect(expandedIds).not.toContain("control-overview");
  });

  it("expands control overview by default on initial entry", () => {
    const expandedIds = resolveExpandedNavigationIds({
      manualExpandedIds: [],
      manualCollapsedIds: [],
      activePath: [],
      filteredExpandedIds: [],
      query: "",
    });

    expect(expandedIds).toContain("control-overview");
    expect(expandedIds).toContain("dashboard");
    expect(expandedIds).not.toContain("analytics");
  });

  it("expands Analytics only when the active page is inside Analytics", () => {
    const expandedIds = resolveExpandedNavigationIds({
      manualExpandedIds: [],
      manualCollapsedIds: [],
      activePath: [
        "control-overview",
        "dashboard",
        "analytics",
        "dashboard-analytics",
      ],
      filteredExpandedIds: [],
      query: "",
    });

    expect(expandedIds).toContain("analytics");
  });

  it("expands active page nodes that own hash panel children", () => {
    const expandedIds = resolveExpandedNavigationIds({
      manualExpandedIds: [],
      manualCollapsedIds: [],
      activePath: ["identity-access", "role-permissions"],
      filteredExpandedIds: [],
      query: "",
    });

    expect(expandedIds).toContain("role-permissions");
  });

  it("keeps search-driven ancestors expanded even if they were manually collapsed", () => {
    const expandedIds = resolveExpandedNavigationIds({
      manualExpandedIds: [],
      manualCollapsedIds: ["identity-access"],
      activePath: [],
      filteredExpandedIds: ["identity-access", "role-permissions"],
      query: "reviewer",
    });

    expect(expandedIds).toContain("identity-access");
    expect(expandedIds).toContain("role-permissions");
  });
});
