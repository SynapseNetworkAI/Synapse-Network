export function getGatewayBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location?.hostname) {
    return `http://${window.location.hostname}:8000`;
  }

  return "http://127.0.0.1:8000";
}
