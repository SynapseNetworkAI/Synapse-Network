import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BARE_PRODUCTION_HOST = "synapse-network.ai";
const CANONICAL_PRODUCTION_HOST = "www.synapse-network.ai";

function normalizeHost(value: string | null): string {
  const firstHost = (value || "").split(",")[0]?.trim().toLowerCase() || "";
  return firstHost.split(":")[0] || "";
}

export function getCanonicalWwwRedirectUrl(
  requestUrl: URL,
  headers: Headers,
): URL | null {
  const forwardedHost = normalizeHost(headers.get("x-forwarded-host"));
  const host = forwardedHost || normalizeHost(headers.get("host"));

  if (host !== BARE_PRODUCTION_HOST) {
    return null;
  }

  const redirectUrl = new URL(requestUrl.toString());
  redirectUrl.protocol = "https:";
  redirectUrl.host = CANONICAL_PRODUCTION_HOST;
  return redirectUrl;
}

export function middleware(request: NextRequest) {
  const redirectUrl = getCanonicalWwwRedirectUrl(
    new URL(request.nextUrl.toString()),
    request.headers,
  );

  if (redirectUrl) {
    return NextResponse.redirect(redirectUrl, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
