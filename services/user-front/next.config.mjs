function normalizeGatewayProxyTarget(rawUrl) {
  const fallback = "http://127.0.0.1:8000";
  const value = (rawUrl || fallback).trim() || fallback;

  try {
    const parsed = new URL(value);
    if (parsed.hostname === "localhost" && parsed.port === "8000") {
      // Next.js rewrites run server-side; 127.0.0.1 avoids localhost -> ::1
      // resolution issues when the Python gateway only listens on IPv4.
      parsed.hostname = "127.0.0.1";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function normalizeDocsBaseUrl(rawUrl) {
  const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || "local").trim();
  const fallback =
    appEnv === "prod" || appEnv === "production"
      ? "https://docs.synapse-network.ai"
      : appEnv === "staging"
        ? "https://docs-staging.synapse-network.ai"
        : "http://localhost:3100";
  const value = (rawUrl || fallback).trim() || fallback;

  try {
    const parsed = new URL(value);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

const gatewayBaseUrl = normalizeGatewayProxyTarget(
  process.env.NEXT_PUBLIC_GATEWAY_BASE_URL,
);
const docsBaseUrl = normalizeDocsBaseUrl(process.env.NEXT_PUBLIC_DOCS_BASE_URL);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile @metamask/sdk and its deps so webpack handles them correctly
  transpilePackages: ["@metamask/sdk", "@metamask/sdk-communication-layer"],
  // Optimize heavy barrel imports — reduces per-route module count significantly
  experimental: {
    optimizePackageImports: [
      "@rainbow-me/rainbowkit",
      "lucide-react",
      "@tanstack/react-query",
    ],
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    // 忽略被 web3 第三方包错误引入的 React Native 依赖
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      // Resolve cross-fetch to browser ponyfill to fix @metamask/sdk bundling
      "cross-fetch": "cross-fetch/dist/browser-ponyfill.js",
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${gatewayBaseUrl}/api/v1/:path*`,
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: `${gatewayBaseUrl}/.well-known/oauth-authorization-server`,
      },
      {
        source: "/.well-known/jwks.json",
        destination: `${gatewayBaseUrl}/.well-known/jwks.json`,
      },
      {
        source: "/oauth/authorize/approve",
        destination: `${gatewayBaseUrl}/oauth/authorize/approve`,
      },
      {
        source: "/oauth/token",
        destination: `${gatewayBaseUrl}/oauth/token`,
      },
      {
        source: "/oauth/revoke",
        destination: `${gatewayBaseUrl}/oauth/revoke`,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "synapse-network.ai" }],
        destination: "https://www.synapse-network.ai/:path*",
        permanent: true,
      },
      {
        source: "/docs",
        destination: docsBaseUrl,
        permanent: true,
      },
      {
        source: "/docs/getting-started/consumer",
        destination: `${docsBaseUrl}/get-started/agent-builders`,
        permanent: true,
      },
      {
        source: "/docs/getting-started/provider",
        destination: `${docsBaseUrl}/get-started/api-providers`,
        permanent: true,
      },
      {
        source: "/docs/getting-started/:path*",
        destination: `${docsBaseUrl}/get-started/:path*`,
        permanent: true,
      },
      {
        source: "/docs/sdk/:path*",
        destination: `${docsBaseUrl}/sdks/:path*`,
        permanent: true,
      },
      {
        source: "/docs/contracts/:path*",
        destination: `${docsBaseUrl}/smart-contracts/:path*`,
        permanent: true,
      },
      {
        source: "/docs/:path*",
        destination: `${docsBaseUrl}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
