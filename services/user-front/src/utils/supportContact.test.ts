import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSupportMailto,
  getSupportContactAvailable,
  getSupportEmail,
  getSupportPortalUrl,
} from "./supportContact";

const originalSupportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
const originalSupportPortalUrl = process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL;

function restoreEnv(
  key: "NEXT_PUBLIC_SUPPORT_EMAIL" | "NEXT_PUBLIC_SUPPORT_PORTAL_URL",
  value: string | undefined
) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("supportContact", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    delete process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL;
  });

  afterEach(() => {
    restoreEnv("NEXT_PUBLIC_SUPPORT_EMAIL", originalSupportEmail);
    restoreEnv("NEXT_PUBLIC_SUPPORT_PORTAL_URL", originalSupportPortalUrl);
  });

  it("returns the configured public support email and builds a mailto link", () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = " support@synapse.test ";

    expect(getSupportEmail()).toBe("support@synapse.test");
    expect(getSupportPortalUrl()).toBeNull();
    expect(getSupportContactAvailable()).toBe(true);
    expect(buildSupportMailto(" Billing help ")).toBe(
      "mailto:support@synapse.test?subject=Billing%20help"
    );
  });

  it("returns the configured support portal when email is not configured", () => {
    process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL =
      " https://support.synapse.test ";

    expect(getSupportEmail()).toBeNull();
    expect(getSupportPortalUrl()).toBe("https://support.synapse.test");
    expect(getSupportContactAvailable()).toBe(true);
    expect(buildSupportMailto()).toBeNull();
  });

  it("falls back to unavailable when both support contacts are empty", () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = " ";
    process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL = "";

    expect(getSupportEmail()).toBeNull();
    expect(getSupportPortalUrl()).toBeNull();
    expect(getSupportContactAvailable()).toBe(false);
    expect(buildSupportMailto()).toBeNull();
  });
});
