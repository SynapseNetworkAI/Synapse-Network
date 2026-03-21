import { describe, expect, it } from "vitest";

import { buildAdminNavigation, filterNavigation, findNavItemByPath, findNavPathByPath, getNavVisual, resolveExpandedNavigationIds } from "./navigation";

function createMenuItem(overrides: Partial<{
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
}> = {}) {
  return {
    itemId: "dashboard",
    sectionId: "control-overview",
    sectionLabel: "控制总览",
    sectionDescription: "总览、执行态与系统健康。",
    label: "控制台",
    href: "/dashboard",
    description: "overview",
    parentItemId: null,
    nodeType: "page" as const,
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
      }),
      createMenuItem({
        itemId: "dashboard-runtime",
        label: "运行态",
        href: null,
        parentItemId: "dashboard",
        nodeType: "panel",
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

    expect(navigation.map((section) => section.id)).toEqual(["control-overview", "business-control"]);
    expect(navigation[0]?.children?.[0]?.id).toBe("dashboard");
    expect(navigation[0]?.children?.[0]?.children?.map((item) => item.id)).toEqual(["dashboard-runtime"]);
    expect(navigation[1]?.children?.[0]?.id).toBe("finance");
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
});

describe("getNavVisual", () => {
  it("returns the Sentinel metadata for known items", () => {
    expect(getNavVisual("dashboard")).toEqual({ icon: "DA", kicker: "总览、运行态与系统健康入口。" });
  });

  it("returns a generic fallback for unknown items", () => {
    expect(getNavVisual("unknown")).toEqual({ icon: "SN", kicker: "control module" });
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
      href: "/dashboard",
      description: "overview",
      parentItemId: "control-overview",
      iconKey: "OV",
      sortOrder: 10,
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
      iconKey: "RB",
      sortOrder: 20,
    }),
    createMenuItem({
      itemId: "reviewer-split",
      sectionId: "identity-access",
      sectionLabel: "身份与权限",
      sectionDescription: "后台用户、角色策略与导航治理。",
      label: "Reviewer 分工",
      href: null,
      description: "reviewer responsibility",
      parentItemId: "role-permissions",
      nodeType: "panel",
      iconKey: "RV",
      sortOrder: 21,
    }),
  ]);

  it("returns the active path chain for a page", () => {
    expect(findNavPathByPath(navigation, "/role-permissions")).toEqual(["identity-access", "role-permissions"]);
  });

  it("finds the active leaf item for a page", () => {
    expect(findNavItemByPath(navigation, "/dashboard")?.id).toBe("dashboard");
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
      activePath: ["control-overview", "dashboard"],
      filteredExpandedIds: [],
      query: "",
    });

    expect(expandedIds).not.toContain("control-overview");
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