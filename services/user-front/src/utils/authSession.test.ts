// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_SESSION_EXPIRED_EVENT,
  WALLET_SESSION_MISSING_MESSAGE,
  buildAuthedHeaders,
  clearAuthSession,
  getAccessToken,
  normalizeAuthApiError,
  requestAuthChallenge,
  storeAuthSession,
  verifyAuthSignature,
} from "@/utils/authSession";

describe("authSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearAuthSession();
  });

  it("stores sessions with a minimum ttl and builds authenticated headers", () => {
    storeAuthSession("jwt-token", "0xABC", 1);

    expect(getAccessToken("0xabc")).toBe("jwt-token");
    expect(buildAuthedHeaders("0xabc")).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer jwt-token",
      "X-User-Address": "0xabc",
    });
  });

  it("expires mismatched sessions and normalizes auth expiration errors", () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    storeAuthSession("jwt-token", "0xabc", 60);

    expect(() => getAccessToken("0xdef")).toThrow("wallet mismatch");
    expect(expired).toHaveBeenCalled();
    expect(normalizeAuthApiError("token expired", 401)).toBe(
      WALLET_SESSION_MISSING_MESSAGE
    );

    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it("requests auth challenges with chain id and normalizes signature failures", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            challenge: "Sign in",
            domain: "synapse-network.ai",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response("invalid signature", { status: 401 })
      );

    await expect(requestAuthChallenge("0xabc", 421614)).resolves.toMatchObject({
      challenge: "Sign in",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("chainId=421614");

    await expect(
      verifyAuthSignature("0xabc", "message", "0xsig")
    ).rejects.toThrow("Wallet signature invalid");
  });
});
