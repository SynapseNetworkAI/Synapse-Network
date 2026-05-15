import { describe, expect, it, vi } from "vitest";

import {
  buildAdminApiProxyHeaders,
  buildAdminApiProxyUrl,
  normalizeAdminApiProxyTarget,
  resolveAdminApiProxyAudience,
  shouldAttachGoogleIdentityToken,
} from "./admin-api-proxy";

describe("admin api proxy helpers", () => {
  it("normalizes the configured target", () => {
    expect(
      normalizeAdminApiProxyTarget(
        "https://admin-api.synapse-network.ai/",
      ),
    ).toBe("https://admin-api.synapse-network.ai");
  });

  it("uses explicit proxy audience when provided", () => {
    const original = process.env.ADMIN_API_PROXY_AUDIENCE;
    process.env.ADMIN_API_PROXY_AUDIENCE =
      "https://admin-api.synapse-network.ai";
    expect(
      resolveAdminApiProxyAudience("https://admin-api-internal.example"),
    ).toBe("https://admin-api.synapse-network.ai");
    process.env.ADMIN_API_PROXY_AUDIENCE = original;
  });

  it("falls back to target for the default audience", () => {
    const original = process.env.ADMIN_API_PROXY_AUDIENCE;
    delete process.env.ADMIN_API_PROXY_AUDIENCE;
    expect(
      resolveAdminApiProxyAudience(
        "https://admin-api.synapse-network.ai/",
      ),
    ).toBe("https://admin-api.synapse-network.ai");
    process.env.ADMIN_API_PROXY_AUDIENCE = original;
  });

  it("attaches google identity tokens only for non-local https targets", () => {
    expect(
      shouldAttachGoogleIdentityToken(
        "https://admin-api.synapse-network.ai",
      ),
    ).toBe(true);
    expect(shouldAttachGoogleIdentityToken("http://localhost:8300")).toBe(
      false,
    );
    expect(
      shouldAttachGoogleIdentityToken("https://127.0.0.1:8300"),
    ).toBe(false);
  });

  it("builds upstream urls from target and request path", () => {
    expect(
      buildAdminApiProxyUrl(
        "https://admin-api.synapse-network.ai/",
        "/api/admin/v1/auth/me",
        "?page=2",
      ),
    ).toBe("https://admin-api.synapse-network.ai/api/admin/v1/auth/me?page=2");
  });

  it("preserves cookies and csrf while replacing bearer auth for iam targets", async () => {
    const incoming = new Headers({
      authorization: "Bearer browser-token",
      cookie: "session=abc",
      "x-csrf-token": "csrf-token",
      host: "admin.synapse-network.ai",
      "content-length": "12",
    });
    const provideAuthHeaders = vi.fn().mockResolvedValue({
      Authorization: "Bearer google-id-token",
    });

    const headers = await buildAdminApiProxyHeaders(
      incoming,
      "https://admin-api.synapse-network.ai",
      provideAuthHeaders,
    );

    expect(provideAuthHeaders).toHaveBeenCalledOnce();
    expect(headers.get("authorization")).toBe("Bearer google-id-token");
    expect(headers.get("cookie")).toBe("session=abc");
    expect(headers.get("x-csrf-token")).toBe("csrf-token");
    expect(headers.has("host")).toBe(false);
    expect(headers.has("content-length")).toBe(false);
  });

  it("skips oidc token minting for local proxy targets", async () => {
    const incoming = new Headers({
      authorization: "Bearer browser-token",
    });
    const provideAuthHeaders = vi.fn().mockResolvedValue({
      Authorization: "Bearer google-id-token",
    });

    const headers = await buildAdminApiProxyHeaders(
      incoming,
      "http://localhost:8300",
      provideAuthHeaders,
    );

    expect(provideAuthHeaders).not.toHaveBeenCalled();
    expect(headers.get("authorization")).toBe("Bearer browser-token");
  });
});
