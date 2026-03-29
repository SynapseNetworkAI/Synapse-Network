/** @type {import('next').NextConfig} */
/** @type {string} */
const adminApiProxyTarget = (process.env.ADMIN_API_PROXY_TARGET || "http://localhost:8300").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/admin/:path*",
        destination: adminApiProxyTarget + "/api/admin/:path*",
      },
    ];
  },
};

export default nextConfig;
