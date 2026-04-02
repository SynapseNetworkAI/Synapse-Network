import { describe, expect, it } from "vitest";

import { resolvePermitDomainChainId } from "./permitChain";

describe("resolvePermitDomainChainId", () => {
  it("returns the active chain id when it is a positive integer", () => {
    expect(resolvePermitDomainChainId(421614)).toBe(421614);
    expect(resolvePermitDomainChainId(84532)).toBe(84532);
  });

  it("returns null for invalid chain ids", () => {
    expect(resolvePermitDomainChainId(undefined)).toBeNull();
    expect(resolvePermitDomainChainId(null)).toBeNull();
    expect(resolvePermitDomainChainId(0)).toBeNull();
    expect(resolvePermitDomainChainId(Number.NaN)).toBeNull();
  });
});
