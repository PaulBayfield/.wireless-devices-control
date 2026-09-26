import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server.js for the Docker image: no node_modules at runtime.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
