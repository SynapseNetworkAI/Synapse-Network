import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentAdmin, resolveAdminApiBaseUrl } from "./admin-api";

describe("admin session expiry handling", () => {
  const originalFetch = globalThis.fetch;
  const replaceSpy = vi.fn();
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.restoreAllMocks();
    replaceSpy.mockReset();
    storage.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          pathname: "/withdrawal-reviews",
          replace: replaceSpy,
        },
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storage.set(key, value);
          },
          removeItem: (key: string) => {
            storage.delete(key);
          },
          clear: () => {
            storage.clear();
          },
        },
      },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: globalThis.window.sessionStorage,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("clears the csrf token and redirects to login when the admin session has expired", async () => {
    globalThis.sessionStorage.setItem("synapse.admin.csrfToken", "persisted-token");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Admin session expired",
        },
        requestId: "req_expired",
      }),
    }) as typeof fetch;

    await expect(getCurrentAdmin("cookie-session")).rejects.toThrow("Admin session expired");
    expect(globalThis.sessionStorage.getItem("synapse.admin.csrfToken")).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith("/login");
  });
});

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