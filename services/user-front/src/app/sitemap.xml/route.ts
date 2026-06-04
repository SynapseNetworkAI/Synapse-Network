const SITE_URL = "https://www.synapse-network.ai";

const PUBLIC_ROUTES = [
  { path: "/", changeFrequency: "weekly", priority: "1.0" },
  { path: "/about", changeFrequency: "monthly", priority: "0.7" },
  { path: "/ai-agent-payments", changeFrequency: "monthly", priority: "0.8" },
  { path: "/agent-payment-api", changeFrequency: "monthly", priority: "0.8" },
  { path: "/marketplace", changeFrequency: "monthly", priority: "0.7" },
  { path: "/forum", changeFrequency: "monthly", priority: "0.7" },
] as const;

function buildUrl(path: string) {
  return `${SITE_URL}${path === "/" ? "" : path}`;
}

function buildSitemapXml() {
  const lastModified = new Date().toISOString();
  const entries = PUBLIC_ROUTES.map(
    (route) => `  <url>
    <loc>${buildUrl(route.path)}</loc>
    <lastmod>${lastModified}</lastmod>
    <changefreq>${route.changeFrequency}</changefreq>
    <priority>${route.priority}</priority>
  </url>`,
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

export function GET() {
  return new Response(buildSitemapXml(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
