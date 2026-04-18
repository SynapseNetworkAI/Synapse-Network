import { describe, expect, it } from "vitest";

import { ALL_ROUTES } from "@/app/docs/api-reference/endpoint-data";
import {
  DOCS_API_ENDPOINT_REGISTRY,
  DOCS_FULL_PAGE_REGISTRY,
  DOCS_IMPLEMENTED_ROUTES,
  DOCS_NAV_REGISTRY,
  DOCS_PAGE_REGISTRY,
} from "@/app/docs/docs-page-registry";
import { getDocsNavTree } from "@/app/docs/nav-tree";

describe("docs page registry", () => {
  it("covers every docs nav item with an implemented page, anchor, soon marker, or external resource", () => {
    const navItems = getDocsNavTree([], []).flatMap((section) => section.items);
    const navRegistryIds = new Set(DOCS_NAV_REGISTRY.map((item) => item.id));

    expect(DOCS_NAV_REGISTRY).toHaveLength(navItems.length);
    for (const item of navItems) {
      expect(navRegistryIds.has(item.id)).toBe(true);
    }
  });

  it("keeps every implemented docs route in the canonical route allowlist", () => {
    const implementedRoutes = new Set(DOCS_IMPLEMENTED_ROUTES);

    for (const item of DOCS_PAGE_REGISTRY) {
      const [path] = item.href.split("#");
      expect(implementedRoutes.has(path as (typeof DOCS_IMPLEMENTED_ROUTES)[number])).toBe(true);
      expect(item.implemented).toBe(true);
    }
  });

  it("maps every hash nav item to an anchor declared by its page registry item", () => {
    const anchorsByPath = new Map<string, Set<string>>();
    for (const item of DOCS_PAGE_REGISTRY) {
      const [path] = item.href.split("#");
      anchorsByPath.set(path, new Set(item.expectedAnchors));
    }

    for (const item of DOCS_NAV_REGISTRY.filter((entry) => entry.kind === "anchor")) {
      const [path, anchor] = item.href.split("#");
      expect(anchor).toBeTruthy();
      expect(anchorsByPath.get(path)?.has(anchor)).toBe(true);
    }
  });

  it("treats status as soon and resource links as non-doc resources", () => {
    const status = DOCS_NAV_REGISTRY.find((item) => item.id === "status");
    const changelog = DOCS_NAV_REGISTRY.find((item) => item.id === "changelog");
    const community = DOCS_NAV_REGISTRY.find((item) => item.id === "community");

    expect(status?.kind).toBe("soon");
    expect(status?.implemented).toBe(false);
    expect(changelog?.kind).toBe("external");
    expect(changelog?.href).toBe("/blog");
    expect(community?.kind).toBe("external");
    expect(community?.href.startsWith("https://")).toBe(true);
  });

  it("covers every API endpoint detail route from ROUTE_GROUPS", () => {
    const apiHrefs = new Set(DOCS_API_ENDPOINT_REGISTRY.map((item) => item.href));

    expect(DOCS_API_ENDPOINT_REGISTRY).toHaveLength(ALL_ROUTES.length);
    for (const route of ALL_ROUTES) {
      expect(apiHrefs.has(`/docs/api-reference/${route.id}`)).toBe(true);
    }
  });

  it("does not duplicate full registry ids", () => {
    const ids = DOCS_FULL_PAGE_REGISTRY.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
