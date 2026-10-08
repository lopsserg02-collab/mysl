import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { boardReady, guard, signIn } from "./helpers";

const list = (p: Page) => p.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");
const root = (p: Page) => p.locator("[data-tool]");
const nav = (p: Page) => p.getByRole("navigation", { name: "Инструменты" });

async function start(page: Page) {
  await signIn(page, `bp-${Math.random().toString(36).slice(2, 8)}@example.com`, "Настройки");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
}

async function stroke(page: Page, y: number) {
  await page.mouse.move(300, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(300 + i * 20, y);
  await page.mouse.up();
}

test("board background: colour and grid for everyone, live, after reload, undoable, and in the export", async ({ page, context }) => {
  const check = guard(page);
  await start(page);
  await page.keyboard.press("t");
  await page.mouse.click(600, 400);
  await page.getByLabel("Текст", { exact: true }).fill("Читается");
  await page.keyboard.press("Escape");

  const other = await context.newPage();
  await other.goto(page.url());
  await boardReady(other);
  await expect(root(other)).toHaveAttribute("data-board-bg", "default");

  await page.getByRole("button", { name: "Фон доски" }).click();
  const panel = page.getByRole("dialog", { name: "Фон доски" });
  await panel.getByRole("radio", { name: "Графитовый, тёмный" }).check({ force: true });
  await panel.getByRole("radio", { name: "Линии" }).check({ force: true });
  await expect(root(page)).toHaveAttribute("data-board-bg", "graphite");
  await expect(root(page)).toHaveAttribute("data-grid", "lines");
  await expect(root(page)).toHaveCSS("background-color", "rgb(30, 34, 40)");
  // The other tab follows live.
  await expect(root(other)).toHaveAttribute("data-board-bg", "graphite");
  await expect(root(other)).toHaveAttribute("data-grid", "lines");
  // Default ink turns light on the dark board, so text stays readable.
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(620, 400);
  await expect(page.getByLabel("Текст", { exact: true })).toHaveCSS("color", "rgb(236, 238, 241)");
  await page.keyboard.press("Escape");

  // Export draws on the chosen background.
  await page.mouse.click(1300, 820);
  await page.getByRole("button", { name: "Экспорт" }).click();
  const dialog = page.getByRole("dialog", { name: "Экспорт доски" });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  const png = await readFile((await (await download).path())!);
  const corner = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(2, 2, 1, 1).data.slice(0, 3)];
  }, png.toString("base64"));
  expect(corner).toEqual([30, 34, 40]);

  // Survives a reload.
  await page.reload();
  await boardReady(page);
  await expect(root(page)).toHaveAttribute("data-board-bg", "graphite");
  await expect(root(page)).toHaveAttribute("data-grid", "lines");

  // Undo, one change at a time.
  await page.getByRole("button", { name: "Фон доски" }).click();
  await panel.getByRole("radio", { name: "Без сетки" }).check({ force: true });
  await expect(root(page)).toHaveAttribute("data-grid", "none");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(root(page)).toHaveAttribute("data-grid", "lines");
  await expect(root(other)).toHaveAttribute("data-grid", "lines");
  await other.close();
  check();
});

test("brush size: presets, slider and [ ] per tool, remembered; a selected drawing's width changes and undoes", async ({ page }) => {
  const check = guard(page);
  await start(page);
  const settings = page.getByRole("toolbar", { name: "Настройки инструмента" });
  await page.keyboard.press("p");
  await settings.getByRole("radio", { name: "8 пт", exact: true }).click();
  await stroke(page, 300);
  await expect(list(page)).toHaveText(["Рисунок, толщина 8"]);

  // ] and [ step through the presets.
  await page.keyboard.press("]");
  await expect(settings.getByRole("radio", { name: "12 пт", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  await expect(settings.getByRole("radio", { name: "5 пт", exact: true })).toHaveAttribute("aria-checked", "true");
  // The slider sets any size in range.
  await settings.getByRole("slider", { name: "Толщина" }).fill("7");
  await expect(settings.getByRole("slider", { name: "Толщина" })).toHaveValue("7");
  // Keys do nothing while the slider has focus; leave it.
  await settings.getByRole("slider", { name: "Толщина" }).blur();
  // Each tool keeps its own size.
  await page.keyboard.press("m");
  await expect(settings.getByRole("radio", { name: "16 пт", exact: true })).toHaveAttribute("aria-checked", "true");
  // Remembered for this person after a reload.
  await page.reload();
  await boardReady(page);
  await page.keyboard.press("p");
  await expect(settings.getByRole("slider", { name: "Толщина" })).toHaveValue("7");

  // A selected drawing: change its width, undo, and step it with ].
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a"); // the reload centred the view on the drawing
  const sel = page.getByRole("toolbar", { name: "Свойства выбранного" });
  await sel.getByRole("radio", { name: "2 пт", exact: true }).click();
  await expect(list(page)).toHaveText(["Рисунок, толщина 2"]);
  await page.keyboard.press("Control+z");
  await expect(list(page)).toHaveText(["Рисунок, толщина 8"]);
  await page.keyboard.press("]");
  await expect(list(page)).toHaveText(["Рисунок, толщина 12"]);

  // A big eraser takes a stroke it only passes near.
  await page.keyboard.press("e");
  await settings.getByRole("radio", { name: "96 пт", exact: true }).click();
  await page.mouse.click(720, 490); // the drawing sits across the middle of the view, 40 px above
  await expect(list(page)).toHaveCount(0);
  check();
});

test("toolbar: move by menu and by dragging, compact with «Ещё», remembered, fits a phone", async ({ page }) => {
  const check = guard(page);
  await start(page);
  await expect(nav(page)).toHaveAttribute("data-side", "left");

  // Keyboard: the grip opens a menu.
  const grip = page.getByRole("button", { name: /Панель инструментов: перетащите/ });
  await grip.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Положение панели инструментов" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Слева" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "Сверху" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(nav(page)).toHaveAttribute("data-side", "top");
  await expect(grip).toBeFocused();
  const header = (await page.locator("header").first().boundingBox())!;
  let box = (await nav(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(box.height);
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);

  // Compact: fewer tools, the rest under «Ещё».
  await grip.click();
  await menu.getByRole("menuitemcheckbox", { name: "Компактно" }).click();
  await expect(nav(page)).toHaveAttribute("data-compact", "true");
  await expect(nav(page).getByRole("button", { name: "Ластик (E)" })).toHaveCount(0);
  await nav(page).getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menu", { name: "Ещё инструменты" }).getByRole("menuitem", { name: "Ластик (E)" }).click();
  await expect(root(page)).toHaveAttribute("data-tool", "eraser");
  await expect(nav(page).getByRole("button", { name: "Ещё" })).toHaveClass(/bg-accent-subtle/);

  // Drag the grip to the right edge: it snaps there.
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(1000, 450, { steps: 6 });
  await page.mouse.move(1420, 460, { steps: 6 });
  await page.mouse.up();
  await expect(nav(page)).toHaveAttribute("data-side", "right");
  box = (await nav(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1440);
  expect(box.height).toBeGreaterThan(box.width);

  // Remembered after a reload.
  await page.reload();
  await boardReady(page);
  await expect(nav(page)).toHaveAttribute("data-side", "right");
  await expect(nav(page)).toHaveAttribute("data-compact", "true");

  // On a phone, every placement stays on screen and clear of the header and the zoom controls.
  await page.setViewportSize({ width: 390, height: 844 });
  const zoom = page.getByRole("button", { name: "Масштаб 100%" });
  for (const where of ["Снизу", "Сверху", "Слева", "Справа"]) {
    await grip.click();
    await menu.getByRole("menuitemradio", { name: where }).click();
    box = (await nav(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    const z = (await zoom.boundingBox())!;
    const overlaps = box.x < z.x + z.width && box.x + box.width > z.x && box.y < z.y + z.height && box.y + box.height > z.y;
    expect(overlaps, where).toBe(false);
  }
  check();
});
