import { describe, expect, it } from "vitest";

import { buildPermissionGroups, buildRoleDomainCards, buildRoleMetrics, buildRoleRiskCards, filterRoles, sortRolesByPriority } from "./role-presenters";

const roles = [
  { roleKey: "finance_admin", roleName: "Finance Admin", description: "Finance ops initiator", status: "active", permissions: ["refund:read", "withdrawal:read"] },
  { roleKey: "super_admin", roleName: "Super Admin", description: "Global access", status: "active", permissions: ["admin_role:grant", "platform_config:update", "approval:read"] },
  { roleKey: "readonly_analyst", roleName: "Readonly Analyst", description: null, status: "disabled", permissions: ["approval:read"] },
];

const permissions = [
  { permissionKey: "refund:read", resourceDomain: "finance", action: "read", riskLevel: "L1", description: null },
  { permissionKey: "withdrawal:read", resourceDomain: "finance", action: "read", riskLevel: "L2", description: null },
  { permissionKey: "admin_role:grant", resourceDomain: "iam", action: "grant", riskLevel: "L3", description: null },
  { permissionKey: "platform_config:update", resourceDomain: "platform", action: "update", riskLevel: "L3", description: null },
  { permissionKey: "approval:read", resourceDomain: "audit", action: "read", riskLevel: "L1", description: null },
];

describe("role-presenters", () => {
  it("groups permissions by domain", () => {
    expect(buildPermissionGroups(permissions).map((group) => group.domain)).toEqual(["audit", "finance", "iam", "platform"]);
  });

  it("filters and sorts roles", () => {
    expect(filterRoles(roles, "finance", "active").map((role) => role.roleKey)).toEqual(["finance_admin"]);
    expect(sortRolesByPriority(roles).map((role) => role.roleKey)).toEqual(["super_admin", "finance_admin", "readonly_analyst"]);
  });

  it("builds role metrics and risk cards", () => {
    expect(buildRoleMetrics(roles, permissions)).toEqual({
      totalRoles: 3,
      activeCount: 2,
      disabledCount: 1,
      maxPermissionCount: 3,
      coveredPermissionCount: 5,
      uncoveredPermissionCount: 0,
    });
    expect(buildRoleRiskCards(roles)[0]).toEqual({
      key: "super_admin",
      label: "Super Admin",
      roleKey: "super_admin",
      permissionCount: 3,
      description: "Global access",
      tone: "orange",
    });
  });

  it("builds domain coverage cards", () => {
    expect(buildRoleDomainCards(roles, permissions)).toEqual([
      { key: "finance", label: "finance", permissionCount: 2, coveredCount: 2, activeRoleCount: 1 },
      { key: "audit", label: "audit", permissionCount: 1, coveredCount: 1, activeRoleCount: 1 },
      { key: "iam", label: "iam", permissionCount: 1, coveredCount: 1, activeRoleCount: 1 },
      { key: "platform", label: "platform", permissionCount: 1, coveredCount: 1, activeRoleCount: 1 },
    ]);
  });
});