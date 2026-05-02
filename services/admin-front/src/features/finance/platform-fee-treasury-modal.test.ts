import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppChakraProvider } from "@/components/chakra-provider";
import {
  PlatformFeeTreasuryModal,
  buildPlatformFeeSafeDraftRequestId,
  canUsePlatformFeeTreasury,
  platformFeeDraftErrorMessage,
} from "./platform-fee-treasury-modal";
import { AdminApiError } from "@/services/admin-api";

describe("platform fee treasury modal helpers", () => {
  it("gates platform fee treasury actions to super admins only", () => {
    expect(canUsePlatformFeeTreasury("super_admin")).toBe(true);
    expect(canUsePlatformFeeTreasury("finance_reviewer")).toBe(false);
    expect(canUsePlatformFeeTreasury("platform_ops_admin")).toBe(false);
    expect(canUsePlatformFeeTreasury(null)).toBe(false);
  });

  it("builds platform-fee scoped request ids", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("safe-draft-id");

    expect(buildPlatformFeeSafeDraftRequestId()).toBe(
      "platform-fee-safe-draft-id"
    );
  });

  it("falls back to a timestamp request id when crypto UUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(36);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });

    expect(buildPlatformFeeSafeDraftRequestId()).toBe("platform-fee-10");

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    dateSpy.mockRestore();
  });

  it("maps platform fee draft failures to operator-safe copy", () => {
    expect(
      platformFeeDraftErrorMessage(
        new AdminApiError("expired", { status: 401, code: "UNAUTHORIZED" })
      )
    ).toContain("Google Authenticator");
    expect(
      platformFeeDraftErrorMessage(
        new AdminApiError("forbidden", { status: 403, code: "FORBIDDEN" })
      )
    ).toBe("Only super admins can create platform fee Safe drafts.");
    expect(
      platformFeeDraftErrorMessage(
        new AdminApiError("pool too low", {
          status: 400,
          code: "PLATFORM_FEE_POOL_INSUFFICIENT",
        })
      )
    ).toBe("pool too low");
    expect(platformFeeDraftErrorMessage(new Error("network down"))).toBe(
      "network down"
    );
    expect(platformFeeDraftErrorMessage("unknown")).toBe(
      "Failed to create platform fee Safe draft."
    );
  });

  it("does not render the modal when closed", () => {
    const html = renderToStaticMarkup(
      createElement(PlatformFeeTreasuryModal, {
        open: false,
        security: null,
        onClose: vi.fn(),
      })
    );

    expect(html).toBe("");
  });

  it("renders the Safe draft form with immutable custody guidance", () => {
    const html = renderToStaticMarkup(
      createElement(
        AppChakraProvider,
        null,
        createElement(PlatformFeeTreasuryModal, {
          open: true,
          security: {
            highRiskTotpRequired: false,
            totpIssuer: "SynapseNetwork Admin",
          },
          onClose: vi.fn(),
        })
      )
    );

    expect(html).toContain("Platform fee treasury draft");
    expect(html).toContain("Ledger guarded");
    expect(html).toContain("Only super admins can create drafts");
    expect(html).toContain("Create Safe draft");
    expect(html).toContain("Amount USDC");
    expect(html).toContain("Reason");
  });
});
