import { defineConfig } from "@playwright/test";

// E2E_PORT / E2E_RT_PORT let several checkouts run their suites side by side; defaults match `npm run dev`.
const port = Number(process.env.E2E_PORT ?? 3000);
const rtPort = Number(process.env.E2E_RT_PORT ?? 1234);
const custom = port !== 3000 || rtPort !== 1234;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
      // Without a UTF-8 locale Chromium drops non-Latin download names, which real browsers keep.
      env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" },
    },
  },
  webServer: {
    command: custom ? `concurrently -k -n web,rt "next dev -p ${port}" "tsx server/realtime.ts"` : "npm run dev",
    env: custom ? { REALTIME_PORT: String(rtPort), NEXT_PUBLIC_REALTIME_URL: `ws://localhost:${rtPort}` } : {},
    url: `http://localhost:${port}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
