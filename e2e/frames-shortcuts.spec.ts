import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { boardReady, guard, signIn } from "./helpers";

const list = (p: Page) => p.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");

async function start(page: Page) {
  await signIn(page, `fs-${Math.random().toString(36).slice(2, 8)}@example.com`, "Порядок");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
}

/** A frame dragged out with the frame tool (board units equal pixels at 100%). */
async function frame(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press("f");
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

test("frames panel: reorder by keyboard, buttons and drag; undoable, synced, and the PDF follows it", async ({ page, context }) => {
  const check = guard(page);
  await start(page);
  // Three frames of different widths, top to bottom: 300, 800 and 150 board units wide.
  await frame(page, [200, 120], [500, 270]);
  await frame(page, [500, 330], [1300, 600]);
  await frame(page, [150, 650], [300, 750]);
  await expect(list(page).filter({ hasText: "Рамка" })).toHaveCount(3);

  await page.getByRole("button", { name: "Рамки" }).click();
  const panel = page.getByRole("complementary", { name: "Рамки" });
  const rows = panel.getByRole("listitem");
  for (const title of ["Один", "Два", "Три"]) {
    await panel.getByRole("button", { name: "Переименовать: Рамка без названия" }).first().click();
    await panel.getByLabel("Название рамки").fill(title);
    await page.keyboard.press("Enter");
  }
  await expect(rows).toHaveText([/Один/, /Два/, /Три/]);

  // Keyboard: Alt+↓ twice on the first row; focus stays on the moved row.
  const one = panel.getByRole("button", { name: "Показать: Один" });
  await one.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(rows).toHaveText([/Два/, /Один/, /Три/]);
  await expect(one).toBeFocused();
  await expect(panel.getByRole("status")).toHaveText("Один: место 2 из 3");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(rows).toHaveText([/Два/, /Три/, /Один/]);
  // Moving a frame in the list does not move it on the board.
  await expect(list(page).filter({ hasText: "Рамка:" })).toHaveCount(3);

  // Buttons.
  await panel.getByRole("button", { name: "Выше: Один" }).click();
  await expect(rows).toHaveText([/Два/, /Один/, /Три/]);
  await expect(panel.getByRole("button", { name: "Выше: Два" })).toBeDisabled();

  // Drag the last row above the first.
  await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 40, y: 4 } });
  await expect(rows).toHaveText([/Три/, /Два/, /Один/]);

  // Each move is one undo step.
  await page.keyboard.press("Control+z");
  await expect(rows).toHaveText([/Два/, /Один/, /Три/]);
  await page.keyboard.press("Control+Shift+z");
  await expect(rows).toHaveText([/Три/, /Два/, /Один/]);

  // Another tab on the same board sees the same order.
  const other = await context.newPage();
  await other.goto(page.url());
  await boardReady(other);
  await other.getByRole("button", { name: "Рамки" }).click();
  await expect(other.getByRole("complementary", { name: "Рамки" }).getByRole("listitem")).toHaveText([/Три/, /Два/, /Один/]);
  await other.close();

  // Frame-by-frame PDF: pages in panel order (widths 150, 800, 300 board units).
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Экспорт" }).click();
  const dialog = page.getByRole("dialog", { name: "Экспорт доски" });
  await dialog.getByLabel("Документ PDF").check();
  await dialog.getByLabel(/Рамки, каждую на своей странице \(3\)/).check();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  const pdf = (await readFile((await (await download).path())!)).toString("latin1");
  const widths = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => Number(m[1]));
  expect(widths).toHaveLength(3);
  expect(widths[0]).toBeLessThan(widths[2]);
  expect(widths[2]).toBeLessThan(widths[1]);
  check();
});

test("shortcuts: a key for every tool, ? opens the list, and keys do nothing while typing", async ({ page }) => {
  const check = guard(page);
  await start(page);
  const tools: [string, string][] = [
    ["o", "Лассо (O)"],
    ["h", "Рука (H)"],
    ["n", "Стикер (N)"],
    ["t", "Текст (T)"],
    ["s", "Фигура (S)"],
    ["l", "Линия со стрелкой (L)"],
    ["p", "Ручка (P)"],
    ["m", "Маркер (M)"],
    ["e", "Ластик (E)"],
    ["f", "Рамка (F)"],
    ["c", "Комментарий (C)"],
    ["v", "Выбор (V)"],
  ];
  const nav = page.getByRole("navigation", { name: "Инструменты" });
  for (const [key, label] of tools) {
    await page.keyboard.press(key);
    await expect(nav.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
  }
  // I opens the image picker.
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("i");
  expect((await chooser).isMultiple()).toBe(true);

  // ? opens the list of shortcuts, in Russian; Escape closes it.
  await page.keyboard.press("Shift+Slash");
  const help = page.getByRole("dialog", { name: "Горячие клавиши" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("heading", { name: "Инструменты" })).toBeVisible();
  await expect(help.getByText("Маркер", { exact: true })).toBeVisible();
  await expect(help.getByText("Ctrl+Shift+G", { exact: true })).toBeVisible();
  // Keys pressed inside the dialog do not switch tools.
  await page.keyboard.press("n");
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
  await expect(nav.getByRole("button", { name: "Выбор (V)" })).toHaveAttribute("aria-pressed", "true");
  // Also from the button in the corner.
  await page.getByRole("button", { name: "Горячие клавиши (?)" }).click();
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Закрыть" }).click();
  await expect(help).not.toBeVisible();

  // Typing letters and ? into a sticky neither switches tools nor opens the help.
  await page.keyboard.press("n");
  await page.mouse.click(600, 400);
  const text = page.getByLabel("Текст стикера");
  await text.pressSequentially("mesh? pilot");
  await expect(text).toHaveValue("mesh? pilot");
  await expect(help).not.toBeVisible();
  await expect(nav.getByRole("button", { name: "Выбор (V)" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(list(page)).toHaveText(["Стикер: mesh? pilot"]);
  check();
});
