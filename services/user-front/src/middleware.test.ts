import { describe, expect, it } from "vitest";

import { getCanonicalWwwRedirectUrl } from "./middleware";

function redirectFor(url: string, headers: Record<string, string>) {
  return getCanonicalWwwRedirectUrl(new URL(url), new Headers(headers));
}

describe("canonical production host middleware", () => {
  it("redirects the bare production host to www while preserving path and query", () => {
    const redirectUrl = redirectFor(
      "https://synapse-network.ai/agent-payment-api?utm=ai",
      { host: "synapse-network.ai" },
    );

    expect(redirectUrl?.toString()).toBe(
      "https://www.synapse-network.ai/agent-payment-api?utm=ai",
    );
  });

  it("uses x-forwarded-host when Cloud Run forwards the original host", () => {
    const redirectUrl = redirectFor("https://run.app/ai-agent-payments", {
      host: "synapse-prod-user-front-gqb4rdk3cq-uc.a.run.app",
      "x-forwarded-host": "synapse-network.ai",
    });

    expect(redirectUrl?.toString()).toBe(
      "https://www.synapse-network.ai/ai-agent-payments",
    );
  });

  it.each([
    "www.synapse-network.ai",
    "staging.synapse-network.ai",
    "localhost:3000",
  ])("does not redirect %s", (host) => {
    expect(redirectFor("https://www.synapse-network.ai/", { host })).toBeNull();
  });
});
