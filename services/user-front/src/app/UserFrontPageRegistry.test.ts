import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pageRegistry from "./user-front-page-registry.json";

type RegistryRow = {
  id: string;
  href: string;
  kind: string;
  purpose: string;
  maturity: string;
  redirectsTo?: string;
  expectedTexts: string[];
  primaryInteractions: string[];
  dataVerification: string;
  dataSources: string[];
  visualVerification: string;
  screenshotName?: string;
};

const rows = pageRegistry as RegistryRow[];
const APP_DIR = path.resolve(process.cwd(), "src/app");

function walkFiles(dir: string, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, results);
      continue;
    }
    if (entry.name === "page.tsx" || entry.name === "route.ts") {
      results.push(fullPath);
    }
  }
  return results;
}

function routeFromAppFile(filePath: string): string {
  const relative = path.relative(APP_DIR, filePath);
  const route = relative
    .replace(/\/page\.tsx$/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/^page\.tsx$/, "")
    .replace(/^route\.ts$/, "");
  return `/${route}`.replace(/\/$/, "") || "/";
}

describe("user-front page registry", () => {
  it("covers every Next app page and route handler", () => {
    const actualRoutes = new Set(walkFiles(APP_DIR).map(routeFromAppFile));
    const documentedRoutes = new Set(rows.map((row) => row.href));

    expect(Array.from(actualRoutes).sort()).toEqual(
      Array.from(documentedRoutes).sort()
    );
  });

  it("has unique ids and hrefs", () => {
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.href)).size).toBe(rows.length);
  });

  it("marks every redirect with a documented target page", () => {
    const documentedRoutes = new Set(rows.map((row) => row.href));
    const redirects = rows.filter((row) => row.kind.includes("redirect"));

    expect(redirects.length).toBeGreaterThan(0);
    for (const row of redirects) {
      expect(
        row.redirectsTo,
        `${row.href} must document redirectsTo`
      ).toBeTruthy();
      if ((row.redirectsTo ?? "").startsWith("http")) {
        expect(row.redirectsTo).toMatch(/^https:\/\//);
      } else {
        expect(
          documentedRoutes.has(row.redirectsTo ?? ""),
          `${row.href} target must exist`
        ).toBe(true);
      }
      expect(row.dataVerification).toBe("none");
    }
  });

  it("does not treat thin or compatibility routes as missing implementation", () => {
    const compatibilityRoutes = rows.filter(
      (row) => row.maturity === "compatibility"
    );
    const thinRoutes = rows.filter((row) => row.maturity === "thin");

    expect(compatibilityRoutes.map((row) => row.href).sort()).toEqual([
      "/dashboard",
      "/dashboard/agents/workspace",
      "/dashboard/console",
      "/dashboard/router",
      "/provider",
      "/provider/sell",
      "/provider/settlements",
    ]);
    expect(thinRoutes.map((row) => row.href).sort()).toEqual([]);
  });

  it("requires data-backed pages to declare backend or chain sources", () => {
    const dataBackedRows = rows.filter(
      (row) =>
        !["none", "static", "static-preview"].includes(row.dataVerification)
    );

    expect(dataBackedRows.length).toBeGreaterThan(0);
    for (const row of dataBackedRows) {
      expect(
        row.dataSources.length,
        `${row.href} should declare data sources`
      ).toBeGreaterThan(0);
      expect(
        row.dataSources.some(
          (source) =>
            source.includes("/api/") ||
            source.includes("chain") ||
            source.includes("wallet") ||
            source.includes("localStorage")
        ),
        `${row.href} should name a concrete API, chain, wallet, or localStorage source`
      ).toBe(true);
    }
  });

  it("requires screenshot pages to declare stable screenshot names", () => {
    const screenshotRows = rows.filter(
      (row) => row.visualVerification === "screenshot-required"
    );

    expect(screenshotRows.length).toBeGreaterThan(0);
    for (const row of screenshotRows) {
      expect(row.screenshotName).toMatch(/^[a-z0-9-]+\.png$/);
    }
  });

  it("documents user-visible interactions for implemented pages", () => {
    for (const row of rows.filter(
      (item) => item.kind === "page" || item.kind === "dynamic-page"
    )) {
      expect(row.purpose.trim().length, `${row.href} purpose`).toBeGreaterThan(
        20
      );
      expect(
        row.primaryInteractions.length,
        `${row.href} interactions`
      ).toBeGreaterThan(0);
      expect(
        row.expectedTexts.length,
        `${row.href} expected texts`
      ).toBeGreaterThan(0);
    }
  });
});
