import { defineConfig } from "@playwright/test";

// E2E_PORT runs the suite on its own web and realtime ports, so two checkouts can test side by side.
const port = Number(process.env.E2E_PORT ?? 3000);
const rtPort = port === 3000 ? 1234 : port + 1;

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
    command:
      port === 3000
        ? "npm run dev"
        : `npx concurrently -k -n web,rt "next dev -p ${port}" "tsx watch server/realtime.ts"`,
    env: port === 3000 ? {} : { REALTIME_PORT: String(rtPort), NEXT_PUBLIC_REALTIME_URL: `ws://localhost:${rtPort}` },
    url: `http://localhost:${port}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
