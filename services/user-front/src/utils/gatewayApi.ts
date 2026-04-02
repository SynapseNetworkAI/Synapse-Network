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

export function getGatewayBaseUrlCandidates(): string[] {
  const envUrl = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL?.trim();
  if (envUrl) {
    return [normalizeBaseUrl(envUrl)];
  }

  if (globalThis.window?.location) {
    const { hostname, origin, port, protocol } = globalThis.window.location;
    if (isLocalDevBrowserHost(hostname, port)) {
      return dedupeUrls([
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
