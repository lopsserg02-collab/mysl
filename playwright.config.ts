import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
      // Without a UTF-8 locale Chromium drops non-Latin download names, which real browsers keep.
      env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" },
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
