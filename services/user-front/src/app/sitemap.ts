import type { MetadataRoute } from "next";

const SITE_URL = "https://synapse-network.ai";

const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/marketplace",
  "/docs",
  "/docs/concepts",
  "/docs/getting-started",
  "/docs/getting-started/consumer",
  "/docs/getting-started/provider",
  "/docs/api-reference",
  "/docs/contracts",
  "/docs/sdk",
  "/docs/sdk/typescript",
  "/docs/sdk/python",
  "/docs/support",
  "/forum",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route === "/" ? "" : route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : route.startsWith("/docs") ? 0.8 : 0.7,
  }));
}
