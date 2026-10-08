import { test, expect, type Page } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);
const peerInks = (p: Page) =>
  p.evaluate(() => (window as unknown as { Konva: { stages: { find(sel: string): unknown[] }[] } }).Konva.stages[0].find(".peer-ink").length);

test("a stroke shows to the other person while it is drawn, and only when «Рисование вживую» is on", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const checkA = guard(a);
  await signIn(a, `ink-${uniq()}@example.com`, "Анна");
  await a.getByRole("button", { name: "Новая доска" }).click();
  await a.waitForURL(/\/board\//);
  await boardReady(a);
  const ctxB = await browser.newContext({ storageState: await ctxA.storageState() });
  const b = await ctxB.newPage();
  const checkB = guard(b);
  await b.goto(a.url());
  await boardReady(b);

  const draw = async () => {
    await a.keyboard.press("p");
    await a.mouse.move(600, 400);
    await a.mouse.down();
    for (let k = 1; k <= 10; k++) await a.mouse.move(600 + k * 15, 400 + k * 8);
  };

  // Button still held: B already sees the stroke; on release it becomes a drawing and the live one goes away.
  await draw();
  await expect.poll(() => peerInks(b)).toBe(1);
  await a.mouse.up();
  await expect.poll(() => peerInks(b)).toBe(0);

  // B turns it off: A's next stroke in progress is not shown to B.
  await b.getByRole("button", { name: "Фон доски" }).click();
  const toggle = b.getByRole("checkbox", { name: /Рисование вживую/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await b.keyboard.press("Escape");
  await draw();
  await a.waitForTimeout(500);
  expect(await peerInks(b)).toBe(0);
  await a.mouse.up();

  checkA();
  checkB();
  await ctxA.close();
  await ctxB.close();
});
