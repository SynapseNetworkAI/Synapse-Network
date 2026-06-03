import { describe, expect, it } from "vitest";

import {
  buildCreateRolePayload,
  buildRoleMutationPayload,
  createEmptyRoleForm,
  createRoleFormFromCatalogItem,
  toggleRolePermission,
} from "./role-form";

describe("role-form", () => {
  it("builds create and update payloads from form state", () => {
    const form = {
      roleKey: "finance_admin",
      roleName: "Finance Admin",
      description: "Finance ops",
      status: "active",
      permissions: ["refund:read", "withdrawal:read"],
    };

    expect(buildCreateRolePayload(form)).toEqual({
      roleKey: "finance_admin",
      roleName: "Finance Admin",
      description: "Finance ops",
      status: "active",
      permissions: ["refund:read", "withdrawal:read"],
    });
    expect(buildRoleMutationPayload(form)).toEqual({
      roleName: "Finance Admin",
      description: "Finance ops",
      status: "active",
      permissions: ["refund:read", "withdrawal:read"],
    });
  });

  it("hydrates edit form state from catalog roles", () => {
    expect(
      createRoleFormFromCatalogItem({
        roleKey: "readonly",
        roleName: "Read Only",
        description: null,
        status: "disabled",
        permissions: ["audit:read"],
      })
    ).toEqual({
      roleKey: "readonly",
      roleName: "Read Only",
      description: "",
      status: "disabled",
      permissions: ["audit:read"],
    });
  });

  it("toggles permission membership deterministically", () => {
    expect(createEmptyRoleForm()).toMatchObject({
      status: "active",
      permissions: [],
    });
    expect(toggleRolePermission(["zeta"], "alpha")).toEqual(["alpha", "zeta"]);
    expect(toggleRolePermission(["alpha", "zeta"], "alpha")).toEqual(["zeta"]);
  });
});
