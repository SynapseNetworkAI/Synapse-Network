import { describe, expect, it } from "vitest";

import {
  buildAdminUserCreateInput,
  buildAdminUserMetrics,
  buildAdminUserUpdateInput,
  buildRoleSnapshots,
  buildUserEditForm,
  buildUserMutationError,
  canManageAdminUsers,
  createEmptyUserForm,
  filterAdminUsers,
  summarizePermissions,
} from "./user-presenters";

const users = [
  {
    adminId: "1",
    email: "alpha@synapse.test",
    displayName: "Alpha",
    status: "active",
    authSource: "password",
    requireMfa: true,
    lastLoginAt: null,
    createdAt: null,
    updatedAt: null,
    roleKeys: ["super_admin"],
    permissions: ["user:read", "user:write", "audit:read", "finance:approve"],
  },
  {
    adminId: "2",
    email: "beta@synapse.test",
    displayName: "Beta",
    status: "disabled",
    authSource: "sso",
    requireMfa: false,
    lastLoginAt: null,
    createdAt: null,
    updatedAt: null,
    roleKeys: ["viewer"],
    permissions: ["user:read"],
  },
];

describe("user-presenters", () => {
  it("filters by search, role, and status", () => {
    expect(
      filterAdminUsers(users, "alpha", "super_admin", "active").map(
        (user) => user.adminId
      )
    ).toEqual(["1"]);
  });

  it("builds user metrics", () => {
    expect(buildAdminUserMetrics(users)).toEqual({
      total: 2,
      active: 1,
      disabled: 1,
      requireMfa: 1,
      privileged: 1,
    });
  });

  it("builds role snapshots", () => {
    expect(
      buildRoleSnapshots(users, [
        {
          roleKey: "super_admin",
          roleName: "Super Admin",
          description: null,
          status: "active",
          permissions: ["one", "two"],
        },
        {
          roleKey: "viewer",
          roleName: "Viewer",
          description: null,
          status: "active",
          permissions: ["read"],
        },
      ])
    ).toEqual([
      {
        roleKey: "super_admin",
        roleName: "Super Admin",
        status: "active",
        permissionCount: 2,
        assignedUsers: 1,
      },
      {
        roleKey: "viewer",
        roleName: "Viewer",
        status: "active",
        permissionCount: 1,
        assignedUsers: 1,
      },
    ]);
  });

  it("summarizes permissions with a hidden counter", () => {
    expect(summarizePermissions(users[0].permissions, 2)).toEqual({
      visible: ["user:read", "user:write"],
      hiddenCount: 2,
    });
  });

  it("builds create and edit form state", () => {
    expect(createEmptyUserForm("viewer")).toEqual({
      email: "",
      displayName: "",
      roleKey: "viewer",
      password: "",
      requireMfa: true,
      status: "active",
    });
    expect(buildUserEditForm(users[0])).toEqual({
      email: "alpha@synapse.test",
      displayName: "Alpha",
      roleKey: "super_admin",
      password: "",
      requireMfa: true,
      status: "active",
    });
  });

  it("builds create and update payloads", () => {
    const form = {
      email: " alpha@synapse.test ",
      displayName: " Alpha ",
      roleKey: "super_admin",
      password: " secret ",
      requireMfa: true,
      status: "active",
    };

    expect(buildAdminUserCreateInput(form)).toEqual({
      email: "alpha@synapse.test",
      displayName: "Alpha",
      roleKey: "super_admin",
      password: " secret ",
      requireMfa: true,
      status: "active",
    });
    expect(buildAdminUserUpdateInput({ ...form, password: "   " })).toEqual({
      displayName: "Alpha",
      roleKey: "super_admin",
      password: undefined,
      requireMfa: true,
      status: "active",
    });
  });

  it("checks admin user management capability", () => {
    expect(
      canManageAdminUsers({
        adminId: "root",
        email: "root@synapse.test",
        displayName: "Root",
        role: "super_admin",
        permissions: [],
      })
    ).toBe(true);
    expect(
      canManageAdminUsers({
        adminId: "viewer",
        email: "viewer@synapse.test",
        displayName: "Viewer",
        role: "viewer",
        permissions: [],
      })
    ).toBe(false);
  });

  it("normalizes mutation errors", () => {
    expect(buildUserMutationError(new Error("bad request"), "fallback")).toBe(
      "bad request"
    );
    expect(buildUserMutationError("bad request", "fallback")).toBe("fallback");
  });
});
