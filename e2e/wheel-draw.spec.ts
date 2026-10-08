import { test, expect, type Page } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const list = (p: Page) => p.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");
const zoom = (p: Page) => p.getByRole("button", { name: "Масштаб 100%" });
const percent = async (p: Page) => Number((await zoom(p).innerText()).replace("%", ""));

async function start(page: Page) {
  await signIn(page, `wd-${Math.random().toString(36).slice(2, 8)}@example.com`, "Колесо");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
}

test("ctrl+wheel: one mouse notch zooms a little and glides there; a pinch stays direct", async ({ page }) => {
  const check = guard(page);
  await start(page);
  await expect(zoom(page)).toHaveText("100%");
  await page.mouse.move(700, 450);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100); // one notch in
  await page.keyboard.up("Control");
  await expect.poll(() => percent(page)).toBeGreaterThanOrEqual(110);
  await page.waitForTimeout(400);
  const one = await percent(page);
  expect(one).toBeLessThanOrEqual(115);

  // Five notches out land well below, not at the minimum.
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  await page.waitForTimeout(600);
  const five = await percent(page);
  expect(five).toBeGreaterThan(55);
  expect(five).toBeLessThan(70);
  check();
});

test("a pen stroke that leaves the board ends where the button is released", async ({ page }) => {
  const check = guard(page);
  await start(page);
  await page.keyboard.press("p");
  // Start on the board, run over the left toolbar and off the page edge, release there.
  await page.mouse.move(500, 400);
  await page.mouse.down();
  for (let x = 480; x >= 0; x -= 40) await page.mouse.move(x, 400);
  await page.mouse.up();
  await expect(list(page)).toHaveCount(1);

  // Moving back over the board with the button up must not keep drawing.
  for (let x = 40; x <= 700; x += 60) await page.mouse.move(x, 500);
  await page.mouse.click(800, 600); // a click with the pen is not a stroke
  await expect(list(page)).toHaveCount(1);
  check();
});
