import { test, expect, type Page } from "@playwright/test";
import { boardReady, signIn } from "./helpers";

// The service worker is registered in production builds only, so this runs against `next build && next start`:
// scripts/offline.sh does that and sets E2E_PROD=1. Under `next dev` it is skipped.
test.skip(process.env.E2E_PROD !== "1", "needs a production build: scripts/offline.sh");

const uniq = () => Math.random().toString(36).slice(2, 8);
const items = (page: Page) => page.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");
const OFFLINE = "Нет сети — изменения сохранятся и отправятся позже";

async function addSticky(page: Page, x: number, text: string) {
  await page.keyboard.press("n");
  await page.mouse.click(x, 450);
  await page.getByLabel("Текст стикера").fill(text);
  await page.keyboard.press("Escape");
}

test("offline: a board opened before loads with no network, edits wait and merge on reconnect", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, `off-${uniq()}@example.com`, "Оля");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
  const url = page.url();
  await addSticky(page, 500, "До сети");
  await expect(items(page)).toHaveText(["Стикер: До сети"]);

  // The worker takes over and keeps this page and its files
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => true)), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await boardReady(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect
    .poll(() => page.evaluate(async (path) => Boolean(await caches.match(path, { ignoreVary: true })), new URL(url).pathname), { timeout: 15_000 })
    .toBe(true);
  // Never kept: API answers
  const kept = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat());
  expect(kept.some((p) => p.startsWith("/api/") || p.startsWith("/auth") || p === "/login")).toBe(false);

  // A collaborator stays online
  const other = await (await browser.newContext({ storageState: await ctx.storageState() })).newPage();
  await other.goto(url);
  await boardReady(other);

  // No network: the board still opens, from this device, with the notice
  await ctx.setOffline(true);
  const res = await page.reload();
  expect(res?.fromServiceWorker()).toBe(true);
  // The network really is gone for the page and its worker
  expect(await page.evaluate(() => fetch("/api/realtime-token", { method: "POST" }).then(() => "online", () => "offline"))).toBe("offline");
  await expect(page.getByRole("navigation", { name: "Инструменты" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible({ timeout: 15_000 });
  await expect(items(page)).toHaveText(["Стикер: До сети"]);

  // Edits made offline stay here and reach the collaborator once the network is back
  await addSticky(page, 900, "Без сети");
  await expect(items(page)).toHaveCount(2);
  await other.waitForTimeout(1000);
  await expect(items(other)).toHaveCount(1);
  await ctx.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toHaveCount(0, { timeout: 20_000 });
  await expect(items(other)).toHaveText(["Стикер: До сети", "Стикер: Без сети"], { timeout: 20_000 });

  // A page never opened before gets a plain notice, not a browser error
  await ctx.setOffline(true);
  await page.goto("/pricing").catch(() => {});
  await expect(page.getByRole("heading", { name: "Нет сети" })).toBeVisible();
  await ctx.setOffline(false);

  // Signing out (the sign-in page) forgets the kept pages
  await page.goto("/login");
  await expect.poll(() => page.evaluate(async (path) => Boolean(await caches.match(path, { ignoreVary: true })), new URL(url).pathname), { timeout: 10_000 }).toBe(false);
  await ctx.close();
});
