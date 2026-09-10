import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The floating dev badge overlaps the workspace's bottom-left controls.
  devIndicators: false,
};
export default nextConfig;
