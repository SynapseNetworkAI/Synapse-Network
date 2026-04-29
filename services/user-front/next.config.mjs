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

const gatewayBaseUrl = normalizeGatewayProxyTarget(process.env.NEXT_PUBLIC_GATEWAY_BASE_URL);

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
    ];
  },
};

export default nextConfig;

