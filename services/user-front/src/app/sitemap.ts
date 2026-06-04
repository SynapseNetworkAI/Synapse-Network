import type { MetadataRoute } from "next";

const SITE_URL = "https://www.synapse-network.ai";

const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/ai-agent-payments",
  "/agent-payment-api",
  "/marketplace",
  "/forum",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route === "/" ? "" : route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
