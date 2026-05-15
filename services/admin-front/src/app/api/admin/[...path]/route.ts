import { NextRequest, NextResponse } from "next/server";

import {
  buildAdminApiProxyHeaders,
  buildAdminApiProxyUrl,
} from "@/server/admin-api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxyAdminRequest(request: NextRequest): Promise<NextResponse> {
  const target = process.env.ADMIN_API_PROXY_TARGET || "http://localhost:8300";
  const upstreamUrl = buildAdminApiProxyUrl(
    target,
    request.nextUrl.pathname,
    request.nextUrl.search
  );
  const headers = await buildAdminApiProxyHeaders(request.headers, target);
  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "content-length" || normalizedKey === "host") {
      return;
    }
    responseHeaders.append(key, value);
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxyAdminRequest;
export const POST = proxyAdminRequest;
export const PUT = proxyAdminRequest;
export const PATCH = proxyAdminRequest;
export const DELETE = proxyAdminRequest;
export const OPTIONS = proxyAdminRequest;
export const HEAD = proxyAdminRequest;
