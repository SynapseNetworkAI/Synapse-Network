import { describe, expect, it } from "vitest";

import { isIgnorableWalletExtensionError, toWalletExtensionErrorDetails } from "@/utils/walletExtensionErrors";

describe("walletExtensionErrors", () => {
  it("ignores MetaMask extension connect failures", () => {
    expect(isIgnorableWalletExtensionError({
      message: "Failed to connect to MetaMask",
      filename: "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js",
    })).toBe(true);
  });

  it("does not ignore unrelated application errors", () => {
    expect(isIgnorableWalletExtensionError({
      message: "Cannot read properties of undefined (reading 'map')",
      filename: "http://localhost:3000/_next/static/chunks/app.js",
    })).toBe(false);
  });

  it("extracts message and stack from native errors", () => {
    const details = toWalletExtensionErrorDetails(new Error("Connector not connected"));
    expect(details.message).toBe("Connector not connected");
    expect(typeof details.stack).toBe("string");
  });
});