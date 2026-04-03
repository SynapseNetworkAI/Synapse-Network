"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export const DOCS_INTERNAL_ROUTES = [
  "/docs",
  "/docs/getting-started",
  "/docs/getting-started/consumer",
  "/docs/getting-started/provider",
  "/docs/concepts",
  "/docs/api-reference",
  "/docs/sdk",
  "/docs/sdk/typescript",
  "/docs/sdk/python",
  "/docs/contracts",
] as const;

const warmedRoutes = new Set<string>();

function normalizePath(href: string) {
  const [path] = href.split("#");
  return path;
}

async function warmWithFetch(path: string) {
  if (typeof globalThis.fetch !== "function") {
    return;
  }

  try {
    await globalThis.fetch(path, {
      credentials: "same-origin",
      headers: {
        "x-synapse-docs-warmup": "1",
      },
    });
  } catch {
    // Ignore warmup failures. The interactive route push still handles navigation.
  }
}

export function warmDocsRoute(router: AppRouterInstance, href: string) {
  const path = normalizePath(href);
  if (!path || !path.startsWith("/docs")) {
    return;
  }

  router.prefetch(path);

  if (warmedRoutes.has(path)) {
    return;
  }

  warmedRoutes.add(path);
  void warmWithFetch(path);
}

export function warmAllDocsRoutes(router: AppRouterInstance) {
  for (const route of DOCS_INTERNAL_ROUTES) {
    warmDocsRoute(router, route);
  }
}
