export function resolvePermitDomainChainId(chainId: number | null | undefined): number | null {
  if (typeof chainId !== "number" || !Number.isFinite(chainId) || chainId <= 0) {
    return null;
  }
  return chainId;
}
