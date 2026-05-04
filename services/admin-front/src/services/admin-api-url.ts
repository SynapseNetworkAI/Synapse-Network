function isLocalBrowserHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

export function shouldUseSameOriginAdminProxy(
  baseUrl: string,
  currentLocation?: Pick<Location, "hostname" | "origin" | "protocol">
): boolean {
  const location =
    currentLocation ??
    (typeof globalThis.window !== "undefined"
      ? globalThis.window.location
      : undefined);
  if (!baseUrl || !location || baseUrl.startsWith("/")) return false;

  try {
    const target = new URL(baseUrl, location.origin);
    return (
      target.origin !== location.origin &&
      target.protocol === location.protocol &&
      isLocalBrowserHostname(target.hostname) &&
      isLocalBrowserHostname(location.hostname)
    );
  } catch {
    return false;
  }
}

export function buildAdminRequestUrl(
  path: string,
  baseUrl: string,
  currentLocation?: Pick<Location, "hostname" | "origin" | "protocol">
): string {
  if (baseUrl && shouldUseSameOriginAdminProxy(baseUrl, currentLocation)) {
    return path;
  }
  return baseUrl ? `${baseUrl}${path}` : path;
}
