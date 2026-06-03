import { describe, expect, it } from "vitest";

import {
  buildCreateMenuItemPayload,
  buildMenuItemDraftPayload,
  createMenuFormFromItem,
  parseMenuCsv,
  type MenuFormState,
} from "./menu-config-form";

const form: MenuFormState = {
  itemId: "config-center",
  sectionId: "business-control",
  sectionLabel: "业务控制",
  sectionDescription: "配置、审批和资金风控",
  label: "配置中心",
  href: "/config",
  description: "配置入口",
  parentItemId: "business-control",
  nodeType: "page",
  iconKey: "CF",
  requiredRoles: "super_admin, platform_ops_admin",
  requiredPermissions: "config:read, config:write",
  sortOrder: "42",
  keywords: "config, policy",
};

describe("menu-config-form", () => {
  it("builds menu item payloads from modal form state", () => {
    expect(buildCreateMenuItemPayload(form)).toEqual({
      itemId: "config-center",
      sectionId: "business-control",
      sectionLabel: "业务控制",
      sectionDescription: "配置、审批和资金风控",
      label: "配置中心",
      href: "/config",
      description: "配置入口",
      parentItemId: "business-control",
      nodeType: "page",
      iconKey: "CF",
      requiredRoles: ["super_admin", "platform_ops_admin"],
      requiredPermissions: ["config:read", "config:write"],
      sortOrder: 42,
      keywords: ["config", "policy"],
    });
  });

  it("omits href for non-page nodes and trims CSV values", () => {
    expect(parseMenuCsv("alpha, , beta ,,")).toEqual(["alpha", "beta"]);
    expect(
      buildMenuItemDraftPayload({
        ...form,
        href: "/ignored",
        parentItemId: "",
        nodeType: "category",
        iconKey: "",
        sortOrder: "",
        keywords: "",
      })
    ).toMatchObject({
      href: null,
      parentItemId: null,
      nodeType: "category",
      iconKey: undefined,
      sortOrder: undefined,
      keywords: [],
    });
  });

  it("hydrates the edit form from backend menu items", () => {
    expect(
      createMenuFormFromItem({
        itemId: "runtime-config",
        sectionId: "business-control",
        sectionLabel: "业务控制",
        sectionDescription: "配置、审批和资金风控",
        label: "运行时来源",
        href: "/config/runtime",
        description: "只读运行时来源",
        parentItemId: "config-center",
        nodeType: "page",
        iconKey: "RT",
        requiredRoles: ["super_admin"],
        requiredPermissions: ["config:read"],
        sortOrder: 43,
        keywords: ["runtime"],
      })
    ).toMatchObject({
      itemId: "runtime-config",
      href: "/config/runtime",
      requiredRoles: "super_admin",
      requiredPermissions: "config:read",
      keywords: "runtime",
      sortOrder: "43",
    });
  });
});
