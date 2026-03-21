import { describe, expect, it } from "vitest";

import { resolveAdminApiBaseUrl } from "./admin-api";

describe("resolveAdminApiBaseUrl", () => {
  it("falls back to same-origin requests when no public API base URL is configured", () => {
    expect(resolveAdminApiBaseUrl(undefined)).toBe("");
    expect(resolveAdminApiBaseUrl("   ")).toBe("");
  });

  it("strips a trailing slash from explicit API base URLs", () => {
    expect(resolveAdminApiBaseUrl("http://localhost:8300/")).toBe("http://localhost:8300");
  });

  it("preserves relative API prefixes when they are explicitly configured", () => {
    expect(resolveAdminApiBaseUrl("/gateway-admin/")).toBe("/gateway-admin");
  });
});