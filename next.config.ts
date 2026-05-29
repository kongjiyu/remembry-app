import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
