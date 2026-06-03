import { describe, expect, it } from "vitest";

import {
  adminRewriteRoutes,
  findAdminRewriteRoute,
  listAdminRewriteModules,
} from "./module-catalog";

const e2eAdminRouteContract = [
  "/approvals",
  "/audit",
  "/config",
  "/config/business-policy",
  "/config/published",
  "/config/runtime",
  "/dashboard",
  "/dashboard/analytics",
  "/dashboard/analytics/consumer-funnel",
  "/dashboard/analytics/data-quality",
  "/dashboard/analytics/invocation-revenue",
  "/dashboard/analytics/money-flow",
  "/dashboard/analytics/provider-revenue",
  "/dashboard/analytics/risk-health",
  "/dashboard/health",
  "/dashboard/overview",
  "/dashboard/runtime",
  "/execution",
  "/finance",
  "/finance/reconciliation",
  "/forum-support",
  "/menu-config",
  "/owner-accounts",
  "/provider-llm-config",
  "/provider-services",
  "/review-history",
  "/risk",
  "/role-permissions",
  "/system",
  "/users",
  "/withdrawal-reviews",
];

describe("admin rewrite module catalog", () => {
  it("covers every authenticated route in the local screenshot contract", () => {
    const catalogRoutes = new Set(
      adminRewriteRoutes.map((route) => route.route)
    );

    expect(Array.from(catalogRoutes).sort()).toEqual(
      [...e2eAdminRouteContract].sort()
    );
    for (const route of e2eAdminRouteContract) {
      expect(findAdminRewriteRoute(route)?.route).toBe(route);
    }
  });

  it("keeps each route mapped to a complete modular workspace spec", () => {
    const seenRoutes = new Set<string>();

    for (const spec of adminRewriteRoutes) {
      expect(seenRoutes.has(spec.route)).toBe(false);
      seenRoutes.add(spec.route);
      expect(spec.module).toBeTruthy();
      expect(spec.mode).toBeTruthy();
      expect(spec.eyebrow.length).toBeGreaterThan(2);
      expect(spec.title.length).toBeGreaterThan(2);
      expect(spec.description.length).toBeGreaterThan(12);
      expect(spec.sections.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("lists the expected module groups for the rewritten sidebar IA", () => {
    expect(listAdminRewriteModules().sort()).toEqual(
      [
        "analytics",
        "approval",
        "audit",
        "business-control",
        "finance",
        "identity",
        "overview",
        "provider",
        "support",
      ].sort()
    );
  });
});
