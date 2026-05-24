function isLocalBrowserHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function isSynapseAdminConsoleHostname(hostname: string): boolean {
  return (
    hostname === "admin.synapse-network.ai" ||
    hostname === "admin-staging.synapse-network.ai"
  );
}

function isSynapseAdminApiHostname(hostname: string): boolean {
  return (
    hostname === "admin-api.synapse-network.ai" ||
    hostname === "admin-api-staging.synapse-network.ai"
  );
}

function isMatchingSynapseAdminPair(
  consoleHostname: string,
  apiHostname: string
): boolean {
  if (consoleHostname === "admin.synapse-network.ai") {
    return apiHostname === "admin-api.synapse-network.ai";
  }
  if (consoleHostname === "admin-staging.synapse-network.ai") {
    return apiHostname === "admin-api-staging.synapse-network.ai";
  }
  return false;
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
    const isLocalProxyPair =
      target.origin !== location.origin &&
      target.protocol === location.protocol &&
      isLocalBrowserHostname(target.hostname) &&
      isLocalBrowserHostname(location.hostname);
    const isSynapseAdminProxyPair =
      target.origin !== location.origin &&
      target.protocol === location.protocol &&
      isSynapseAdminApiHostname(target.hostname) &&
      isSynapseAdminConsoleHostname(location.hostname) &&
      isMatchingSynapseAdminPair(location.hostname, target.hostname);

    return isLocalProxyPair || isSynapseAdminProxyPair;
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
