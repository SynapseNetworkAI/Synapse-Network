/** @type {import('next').NextConfig} */
const nextConfig = {
  // Optimize heavy barrel imports — reduces per-route module count significantly
  experimental: {
    optimizePackageImports: [
      "@rainbow-me/rainbowkit",
      "lucide-react",
      "@tanstack/react-query",
    ],
  },
  // Turbopack config (used when running `next dev --turbo`)
  turbopack: {
    resolveAlias: {
      "@react-native-async-storage/async-storage": { browser: false },
    },
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    // 忽略被 web3 第三方包错误引入的 React Native 依赖
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
