import { describe, expect, it } from "vitest";

import { buildMenuGateCards, buildMenuMetrics, buildMenuSections, buildMenuVersionCards, filterMenuItems, sortMenuItemsByTopology } from "./menu-presenters";

const items = [
  { itemId: "audit", sectionId: "ops", sectionLabel: "Ops", sectionDescription: "Ops tools", label: "Audit", href: "/audit", description: "Audit log", parentItemId: null, nodeType: "page", iconKey: "AT", requiredRoles: ["compliance_auditor"], requiredPermissions: ["audit_admin:read"], sortOrder: 3, keywords: ["audit"] },
  { itemId: "finance", sectionId: "ops", sectionLabel: "Ops", sectionDescription: "Ops tools", label: "Finance", href: "/finance", description: "Finance center", parentItemId: null, nodeType: "page", iconKey: "FN", requiredRoles: [], requiredPermissions: ["finance_dashboard:read"], sortOrder: 1, keywords: ["finance"] },
  { itemId: "users", sectionId: "iam", sectionLabel: "IAM", sectionDescription: "Identity", label: "Users", href: "/users", description: "Admin users", parentItemId: null, nodeType: "page", iconKey: "ID", requiredRoles: ["super_admin"], requiredPermissions: [], sortOrder: 1, keywords: ["users"] },
];

const meta = {
  draftVersion: 6,
  publishedVersion: 5,
  isDirty: true,
  updatedAt: "2026-03-21T10:00:00Z",
  publishedAt: "2026-03-21T08:00:00Z",
  updatedBy: "admin-1",
  publishedBy: "admin-2",
};

describe("menu-presenters", () => {
  it("filters and sorts topology rows", () => {
    expect(filterMenuItems(items, "fin", "ops").map((item) => item.itemId)).toEqual(["finance"]);
    expect(sortMenuItemsByTopology(items).map((item) => item.itemId)).toEqual(["users", "finance", "audit"]);
  });

  it("builds menu metrics and section list", () => {
    expect(buildMenuMetrics(items, meta)).toEqual({
      totalItems: 3,
      sectionCount: 2,
      gatedByRoleCount: 2,
      gatedByPermissionCount: 2,
      multiGatedCount: 1,
      isDirty: true,
    });
    expect(buildMenuSections(items)).toEqual([
      { id: "iam", label: "IAM", count: 1 },
      { id: "ops", label: "Ops", count: 2 },
    ]);
  });

  it("builds version and gate cards", () => {
    expect(buildMenuVersionCards(meta)).toEqual([
      { key: "draft", label: "Draft version", value: "v6", description: "updated 2026-03-21T10:00:00Z", tone: "orange" },
      { key: "published", label: "Published version", value: "v5", description: "published 2026-03-21T08:00:00Z", tone: "gray" },
    ]);
    expect(buildMenuGateCards(items)).toEqual([
      { key: "iam", label: "IAM", totalCount: 1, roleGateCount: 1, permissionGateCount: 0 },
      { key: "ops", label: "Ops", totalCount: 2, roleGateCount: 1, permissionGateCount: 2 },
    ]);
  });
});