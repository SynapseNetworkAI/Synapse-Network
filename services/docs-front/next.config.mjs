import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      {
        source: "/docs",
        destination: "/",
        permanent: true,
      },
      {
        source: "/docs/getting-started/consumer",
        destination: "/get-started/agent-builders",
        permanent: true,
      },
      {
        source: "/docs/getting-started/provider",
        destination: "/get-started/api-providers",
        permanent: true,
      },
      {
        source: "/docs/getting-started/:path*",
        destination: "/get-started/:path*",
        permanent: true,
      },
      {
        source: "/docs/sdk/:path*",
        destination: "/sdks/:path*",
        permanent: true,
      },
      {
        source: "/docs/contracts/:path*",
        destination: "/smart-contracts/:path*",
        permanent: true,
      },
      {
        source: "/docs/:path*",
        destination: "/:path*",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
