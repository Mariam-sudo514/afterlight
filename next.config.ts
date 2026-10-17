import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  agentRules: false,
  images: { unoptimized: true },
  poweredByHeader: false,
};
export default nextConfig;
