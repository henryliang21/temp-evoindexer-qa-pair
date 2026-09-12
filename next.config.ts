import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["mammoth", "exceljs"],
};

export default nextConfig;
