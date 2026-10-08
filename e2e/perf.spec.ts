import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { boardReady, signIn } from "./helpers";

// Performance budget: a board with 10,000 items stays interactive.
// Seeds the board through the development hook, then each animation frame sends one wheel event (pan or zoom)
// or one edit to a random item (as a collaborator would), and records the time between frames.
// Collaborators are real realtime clients started by the test (Node), connected through the realtime server:
// 50 of them move their cursors 30 times a second, and one of them edits a random item 60 times a second.
// Results go to test-results/perf.json and the console. PERF_ITEMS changes the item count, PERF_CURSORS the cursors.
const N = Number(process.env.PERF_ITEMS ?? 10_000);
const CURSORS = Number(process.env.PERF_CURSORS ?? 50);
const RT_URL = `ws://localhost:${process.env.E2E_RT_PORT ?? 1234}`;
const FRAMES = 120;

// Tracing snapshots the page on every step and would skew the timings.
test.use({ trace: "off" });

type Mode = "pan" | "zoom" | "edit" | "idle";
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
          else if (mode === "idle") {
            // nothing: what other people do (cursors, edits) is all that changes
          } else {
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

/** Realtime clients joining the board as the signed-in user would, from Node. */
async function collaborators(page: Page, boardId: string, n: number) {
  const res = await page.request.post("/api/realtime-token", { data: { boardId } });
  const { token } = (await res.json()) as { token: string };
  const clients = await Promise.all(
    Array.from({ length: n }, (_, k) => {
      const doc = new Y.Doc();
      return new Promise<{ doc: Y.Doc; provider: HocuspocusProvider }>((resolve) => {
        const provider = new HocuspocusProvider({ url: RT_URL, name: `board:${boardId}`, document: doc, token, onSynced: () => resolve({ doc, provider }) });
        provider.awareness?.setLocalStateField("user", { userId: `bot-${k}`, name: `Гость ${k + 1}`, color: { fill: "#4262ff", label: "#ffffff" } });
      });
    }),
  );
  let timers: ReturnType<typeof setInterval>[] = [];
  const stop = () => {
    timers.forEach(clearInterval);
    timers = [];
  };
  return {
    /** Every client moves its cursor in a circle around `centre` (board units), 30 times a second. */
    cursors(centre: { x: number; y: number }) {
      let t = 0;
      timers.push(
        setInterval(() => {
          t++;
          clients.forEach(({ provider }, k) => {
            const a = t / 15 + (k * 2 * Math.PI) / clients.length;
            provider.awareness?.setLocalStateField("cursor", { x: Math.round(centre.x + Math.cos(a) * (200 + k * 8)), y: Math.round(centre.y + Math.sin(a) * (150 + k * 5)) });
          });
        }, 33),
      );
    },
    /** The first client moves a random item by a unit, 60 times a second. */
    edits() {
      const { doc } = clients[0];
      const items = doc.getMap<Y.Map<unknown>>("items");
      const ids = [...items.keys()].filter((id) => items.get(id)!.get("type") !== "connector");
      timers.push(
        setInterval(() => {
          const m = items.get(ids[Math.floor(Math.random() * ids.length)]);
          if (m) doc.transact(() => m.set("x", (m.get("x") as number) + 1));
        }, 16),
      );
    },
    stop,
    destroy() {
      stop();
      clients.forEach(({ provider }) => provider.destroy());
    },
  };
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

  // Other people on the board, through the realtime server.
  const boardId = /\/board\/([0-9a-f-]{36})/.exec(page.url())![1];
  const others = await collaborators(page, boardId, CURSORS);
  try {
    await zoomTo(page, "100%", 0);
    // The view centre in board units, so the cursors are on screen.
    const box = await page.locator(".konvajs-content").boundingBox();
    const centre = await page.evaluate(({ w, h }) => {
      const stage = (window as unknown as { Konva: { stages: { x(): number; y(): number; scaleX(): number }[] } }).Konva.stages[0];
      return { x: (w / 2 - stage.x()) / stage.scaleX(), y: (h / 2 - stage.y()) / stage.scaleX() };
    }, { w: box!.width, h: box!.height });
    results.remoteEdit100 = await (async () => {
      others.edits();
      await page.waitForTimeout(500);
      const s = await measure(page, "idle");
      others.stop();
      return s;
    })();
    others.cursors(centre);
    await expect(page.getByRole("img", { name: "Гость 50" })).toHaveCount(CURSORS >= 50 ? 1 : 0);
    await page.waitForTimeout(500);
    results.cursors = CURSORS;
    results.cursorsIdle100 = await measure(page, "idle");
    results.cursorsPan100 = await measure(page, "pan");
    others.edits();
    results.cursorsRemoteEdit100 = await measure(page, "idle");
  } finally {
    others.destroy();
  }

  console.log(JSON.stringify(results, null, 2));
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(path.join("test-results", "perf.json"), JSON.stringify(results, null, 2));

  // Loose guard so a regression shows up without making the suite flaky on slow machines.
  expect((results.pan100 as Stats).p50Ms).toBeLessThan(100);
});
