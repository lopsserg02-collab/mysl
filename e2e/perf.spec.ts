import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { boardReady, signIn } from "./helpers";

// Performance budget: a board with 10,000 items stays interactive.
// Seeds the board through the development hook, then each animation frame sends one wheel event (pan or zoom)
// or one edit to a random item (as a collaborator would), and records the time between frames.
// Results go to test-results/perf.json and the console. PERF_ITEMS changes the item count.
const N = Number(process.env.PERF_ITEMS ?? 10_000);
const FRAMES = 120;

// Tracing snapshots the page on every step and would skew the timings.
test.use({ trace: "off" });

type Mode = "pan" | "zoom" | "edit";
type Stats = { frames: number; meanMs: number; p50Ms: number; p95Ms: number; maxMs: number; fps: number };
type Hook = { seed: (n: number) => number; touch: () => void };

async function measure(page: Page, mode: Mode): Promise<Stats> {
  const times = await page.evaluate(
    ({ frames, mode }) =>
      new Promise<number[]>((resolve) => {
        const target = document.querySelector(".konvajs-content")!;
        const hook = (window as unknown as { __mysl: Hook }).__mysl;
        const out: number[] = [];
        let last = 0;
        let k = 0;
        const start = performance.now();
        const tick = (now: number) => {
          if (last) out.push(now - last);
          last = now;
          if (mode === "edit") hook.touch();
          else {
            const zoom = mode === "zoom";
            // Pan in a slow circle so the view keeps moving over new items; zoom in, then out, around the centre.
            const deltaY = zoom ? (k % 60 < 30 ? -6 : 6) : Math.sin(k / 10) * 12;
            const deltaX = zoom ? 0 : Math.cos(k / 10) * 12;
            target.dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, ctrlKey: zoom, clientX: 720, clientY: 450, bubbles: true, cancelable: true }));
          }
          // Stop after `frames` frames, or after 20 s on a board too slow to get there.
          if (++k <= frames && performance.now() - start < 20_000) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    { frames: FRAMES, mode },
  );
  const sorted = [...times].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const r = (v: number) => Math.round(v * 10) / 10;
  return { frames: times.length, meanMs: r(mean), p50Ms: r(q(0.5)), p95Ms: r(q(0.95)), maxMs: r(sorted.at(-1)!), fps: r(1000 / mean) };
}

async function zoomTo(page: Page, label: string, presses: number) {
  await page.keyboard.press("Control+0");
  for (let i = 0; i < presses; i++) await page.keyboard.press("Control+Minus");
  await expect(page.getByRole("button", { name: "Масштаб 100%" })).toHaveText(label);
  await page.waitForTimeout(300);
}

test(`perf: ${N} items, pan and zoom frame times`, async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, `perf-${Math.random().toString(36).slice(2, 8)}@example.com`, "Замер");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);

  const seedStart = Date.now();
  expect(await page.evaluate((n) => (window as unknown as { __mysl: Hook }).__mysl.seed(n), N)).toBe(N);
  await expect(page.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem")).toHaveCount(N, { timeout: 60_000 });
  const results: Record<string, unknown> = { items: N, seedMs: Date.now() - seedStart, userAgent: await page.evaluate(() => navigator.userAgent) };

  await page.mouse.click(1300, 860); // focus the board
  // Whole board in view: every item is on screen, drawn in low detail.
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(500);
  results.panFit = await measure(page, "pan");
  results.zoomFit = await measure(page, "zoom");
  // 100%: the usual working zoom, a couple of dozen items on screen.
  await page.keyboard.press("Shift+1");
  await zoomTo(page, "100%", 0);
  results.pan100 = await measure(page, "pan");
  results.zoom100 = await measure(page, "zoom");
  results.edit100 = await measure(page, "edit");
  // 50%: about a hundred items in full detail.
  await zoomTo(page, "50%", 2);
  results.pan50 = await measure(page, "pan");
  // 25%: a few hundred items, low detail.
  await zoomTo(page, "25%", 3);
  results.pan25 = await measure(page, "pan");

  console.log(JSON.stringify(results, null, 2));
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(path.join("test-results", "perf.json"), JSON.stringify(results, null, 2));

  // Loose guard so a regression shows up without making the suite flaky on slow machines.
  expect((results.pan100 as Stats).p50Ms).toBeLessThan(100);
});
