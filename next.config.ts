import type { NextConfig } from "next";

// Names the service worker's caches (app/sw.js): each build gets fresh ones and drops the old.
const buildVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.RENDER_GIT_COMMIT?.slice(0, 12) || Date.now().toString(36);

const config: NextConfig = {
  reactStrictMode: true,
  // konva ships a node build that requires the optional "canvas" package; the board only renders in the browser
  serverExternalPackages: ["konva"],
  env: { NEXT_PUBLIC_BUILD_VERSION: buildVersion },
};

export default config;
