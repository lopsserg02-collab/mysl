import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // konva ships a node build that requires the optional "canvas" package; the board only renders in the browser
  serverExternalPackages: ["konva"],
};

export default config;
