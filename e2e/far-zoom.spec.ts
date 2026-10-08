import { test, expect, type Page } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const list = (p: Page) => p.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");
/** The board canvas's colour at a screen point (the canvas is transparent where nothing is drawn). */
const pixel = (p: Page, x: number, y: number) =>
  p.evaluate(([x, y]) => {
    const c = document.querySelector<HTMLCanvasElement>(".konvajs-content canvas")!;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    return [...c.getContext("2d")!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data];
  }, [x, y]);

// Far out the board draws items in bulk, without a canvas node each, and finds them under the pointer by geometry.
test("far out (25%): click picks an item, drag moves it, a frame is picked by its title", async ({ page }) => {
  const check = guard(page);
  await signIn(page, `fz-${Math.random().toString(36).slice(2, 8)}@example.com`, "Далеко");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
  for (const [x, text] of [[520, "Левый"], [920, "Правый"]] as const) {
    await page.keyboard.press("n");
    await page.mouse.click(x, 450);
    await page.getByLabel("Текст стикера").fill(text);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
  await page.mouse.click(1250, 700); // nothing selected, so F starts the frame tool
  await page.keyboard.press("f");
  await page.mouse.click(720, 200); // an 800×450 frame centred at (720, 200)
  await page.keyboard.press("Escape");
  await page.mouse.click(1250, 700);

  for (let k = 0; k < 3; k++) await page.keyboard.press("Control+Minus");
  await expect(page.getByRole("button", { name: "Масштаб 100%" })).toHaveText("25%");
  // Screen = 720 + (board - 720) / 4 around the centre: the right note's centre is at (770, 450).
  await page.mouse.click(770, 450);
  await expect(page.getByRole("toolbar", { name: "Свойства выбранного" })).toBeVisible();
  // Drag it down by 40 px on screen, 160 board units.
  await page.mouse.move(770, 450);
  await page.mouse.down();
  await page.mouse.move(770, 490, { steps: 5 });
  await page.mouse.up();
  // Drawn at its new place and gone from the old one (the far-out drawing is kept in tiles that must follow).
  await page.mouse.click(1250, 700);
  await expect.poll(() => pixel(page, 770, 505)).toEqual([255, 243, 160, 255]);
  await expect.poll(() => pixel(page, 770, 460)).toEqual([0, 0, 0, 0]); // below the frame, where the note was
  await page.mouse.click(770, 490);
  await page.keyboard.press("Delete");
  await expect(list(page)).toHaveText(["Рамка: Рамка", "Стикер: Левый"]);
  await page.keyboard.press("Control+z");
  // It came back where it was dropped: a click at its new place picks it again.
  await page.mouse.click(1250, 700);
  await page.mouse.click(770, 490);
  await page.keyboard.press("Delete");
  await expect(list(page)).toHaveText(["Рамка: Рамка", "Стикер: Левый"]);

  // The frame: its title strip picks it; its empty inside starts a marquee instead.
  await page.mouse.click(720 - 100 + 4, 450 + (200 - 225 - 450) / 4 - 12); // just above the frame's top-left corner
  await page.keyboard.press("Delete");
  await expect(list(page)).toHaveText(["Стикер: Левый"]);
  check();
});
