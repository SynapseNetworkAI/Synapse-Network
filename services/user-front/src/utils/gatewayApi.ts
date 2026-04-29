const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function dedupeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.filter(Boolean).map(normalizeBaseUrl)));
}

function isLocalDevBrowserHost(hostname: string, port: string): boolean {
  if (LOCALHOST_HOSTNAMES.has(hostname)) {
    return true;
  }

  return port === "3000" || port === "3001";
}

function isLocalGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOCALHOST_HOSTNAMES.has(parsed.hostname) && parsed.port === "8000";
  } catch {
    return false;
  }
}

function getLocalBrowserProxyBaseUrl(): string | null {
  if (!globalThis.window?.location) {
    return null;
  }

  const { hostname, origin, port } = globalThis.window.location;
  return isLocalDevBrowserHost(hostname, port)
    ? normalizeBaseUrl(origin)
    : null;
}

export function getGatewayBaseUrlCandidates(): string[] {
  const envUrl = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL?.trim();
  if (envUrl) {
    const normalizedEnvUrl = normalizeBaseUrl(envUrl);
    if (isLocalGatewayUrl(normalizedEnvUrl)) {
      return dedupeUrls([
        getLocalBrowserProxyBaseUrl() ?? "",
        normalizedEnvUrl,
        "http://127.0.0.1:8000",
        "http://localhost:8000",
      ]);
    }
    return [normalizedEnvUrl];
  }

  if (globalThis.window?.location) {
    const { hostname, origin, port, protocol } = globalThis.window.location;
    if (isLocalDevBrowserHost(hostname, port)) {
      return dedupeUrls([
        origin,
        `${protocol}//${hostname}:8000`,
        "http://127.0.0.1:8000",
        "http://localhost:8000",
      ]);
    }
    return [normalizeBaseUrl(origin)];
  }

  return ["http://127.0.0.1:8000"];
}

export function getGatewayBaseUrl(): string {
  return getGatewayBaseUrlCandidates()[0];
}
