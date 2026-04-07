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
};

export default nextConfig;



