import { test, expect, type Page } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const list = (p: Page) => p.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");
const selection = (p: Page) => p.getByRole("toolbar", { name: "Свойства выбранного" });

async function newBoard(page: Page) {
  const back = page.getByRole("link", { name: "Все доски" });
  if (await back.count()) await back.click();
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
}

async function start(page: Page) {
  await signIn(page, `c-${Math.random().toString(36).slice(2, 8)}@example.com`, "Холст");
  await newBoard(page);
}

async function sticky(page: Page, x: number, y: number, text: string) {
  await page.keyboard.press("n");
  await page.mouse.click(x, y);
  await page.getByLabel("Текст стикера").fill(text);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350); // the next click must not read as a double click
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await page.mouse.up();
}

test("text: bold, italic and underline from the toolbar and with Ctrl+B / I / U, undoable", async ({ page }) => {
  const check = guard(page);
  await start(page);
  await page.keyboard.press("t");
  await page.mouse.click(400, 300);
  await page.getByLabel("Текст", { exact: true }).fill("Важно");
  // while typing
  await page.keyboard.press("Control+b");
  await expect(page.getByLabel("Текст", { exact: true })).toHaveCSS("font-weight", "700");
  await page.keyboard.press("Escape");
  await expect(list(page)).toHaveText(["Текст (жирный): Важно"]);

  // with the item selected: toolbar and shortcuts
  await page.waitForTimeout(350);
  await page.mouse.click(420, 300);
  await selection(page).getByRole("button", { name: "Курсив (Ctrl+I)" }).click();
  await expect(list(page)).toHaveText(["Текст (жирный, курсив): Важно"]);
  await expect(selection(page).getByRole("button", { name: "Курсив (Ctrl+I)" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+u");
  await expect(list(page)).toHaveText(["Текст (жирный, курсив, подчёркнутый): Важно"]);
  await page.keyboard.press("Control+b");
  await expect(list(page)).toHaveText(["Текст (курсив, подчёркнутый): Важно"]);
  await page.keyboard.press("Control+z");
  await expect(list(page)).toHaveText(["Текст (жирный, курсив, подчёркнутый): Важно"]);
  check();
});

test("connectors: curved from the tool settings, then switched to elbow and straight", async ({ page }) => {
  const check = guard(page);
  await start(page);
  for (const x of [400, 1000]) {
    await page.keyboard.press("s");
    await page.mouse.click(x, 450);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("l");
  await page.getByRole("toolbar", { name: "Настройки инструмента" }).getByRole("button", { name: "Плавная линия" }).click();
  await drag(page, [400, 450], [1000, 450]);
  await expect(list(page).filter({ hasText: "Линия" })).toHaveText(["Линия плавная между объектами"]);
  // The new connector is selected: change its route from the selection toolbar.
  await selection(page).getByRole("button", { name: "Ломаная линия" }).click();
  await expect(list(page).filter({ hasText: "Линия" })).toHaveText(["Линия ломаная между объектами"]);
  await selection(page).getByRole("button", { name: "Прямая линия" }).click();
  await expect(list(page).filter({ hasText: "Линия" })).toHaveText(["Линия между объектами"]);
  // Click the line itself to select it again, and make it curved.
  await page.mouse.click(1300, 820);
  await page.mouse.click(700, 450);
  await selection(page).getByRole("button", { name: "Плавная линия" }).click();
  await expect(list(page).filter({ hasText: "Линия" })).toHaveText(["Линия плавная между объектами"]);
  check();
});

test("lasso selects what it encloses, freehand", async ({ page }) => {
  const check = guard(page);
  await start(page);
  await sticky(page, 400, 300, "Один");
  await sticky(page, 700, 300, "Два");
  await sticky(page, 1050, 600, "Три");
  await page.mouse.click(1300, 820);
  await page.keyboard.press("o");
  await expect(page.getByRole("button", { name: "Лассо (O)" })).toHaveAttribute("aria-pressed", "true");
  // A loop around the first two notes that leaves the third out.
  await page.mouse.move(250, 150);
  await page.mouse.down();
  for (const [x, y] of [[550, 120], [880, 150], [880, 450], [550, 480], [250, 450], [250, 160]]) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Delete");
  await expect(list(page)).toHaveText(["Стикер: Три"]);
  check();
});

test("group: Ctrl+G groups, a click picks the group, it moves and deletes together; Ctrl+Shift+G ungroups", async ({ page }) => {
  const check = guard(page);
  await start(page);
  await sticky(page, 400, 300, "Первый");
  await sticky(page, 700, 300, "Второй");
  await sticky(page, 1000, 650, "Сам по себе");
  await page.mouse.click(400, 300);
  await page.keyboard.down("Shift");
  await page.mouse.click(700, 300);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Control+g");
  await expect(list(page).filter({ hasText: "в группе" })).toHaveCount(2);

  // Clicking one member and dragging moves both.
  await page.mouse.click(1300, 820);
  await page.waitForTimeout(350);
  await drag(page, [400, 300], [400, 600]);
  await page.mouse.click(1300, 820);
  await page.waitForTimeout(350);
  await page.mouse.dblclick(700, 600);
  await expect(page.getByLabel("Текст стикера")).toHaveValue("Второй");
  await page.keyboard.press("Escape");

  // Clicking one member and pressing Delete removes the whole group.
  await page.waitForTimeout(350);
  await page.mouse.click(400, 600);
  await page.keyboard.press("Delete");
  await expect(list(page)).toHaveText(["Стикер: Сам по себе"]);
  await page.keyboard.press("Control+z");
  await expect(list(page).filter({ hasText: "в группе" })).toHaveCount(2);

  // Ungroup: now a click picks one note only.
  await page.mouse.click(400, 600);
  await page.keyboard.press("Control+Shift+g");
  await expect(list(page).filter({ hasText: "в группе" })).toHaveCount(0);
  await page.mouse.click(1300, 820);
  await page.waitForTimeout(350);
  await page.mouse.click(400, 600);
  await page.keyboard.press("Delete");
  await expect(list(page)).toHaveCount(2);
  check();
});

test("copy, cut and paste: at the pointer, connectors stay attached to the copies, and across boards", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const check = guard(page);
  await start(page);
  await sticky(page, 400, 300, "Причина");
  await sticky(page, 800, 300, "Следствие");
  await page.keyboard.press("l");
  await drag(page, [400, 300], [800, 300]);
  await expect(list(page).filter({ hasText: "Линия между объектами" })).toHaveCount(1);

  // Select both notes; the connector between them comes along.
  await page.mouse.click(1300, 820);
  await page.waitForTimeout(350);
  await page.mouse.click(400, 300);
  await page.keyboard.down("Shift");
  await page.mouse.click(800, 300);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Control+c");
  await page.mouse.move(600, 650);
  await page.keyboard.press("Control+v");
  await expect(list(page).filter({ hasText: "Стикер: Причина" })).toHaveCount(2);
  await expect(list(page).filter({ hasText: "Линия между объектами" })).toHaveCount(2);
  // The copies landed under the pointer, and the pasted items are selected.
  await page.mouse.click(1300, 820);
  await page.waitForTimeout(350);
  await page.mouse.dblclick(400, 650);
  await expect(page.getByLabel("Текст стикера")).toHaveValue("Причина");
  await page.keyboard.press("Escape");

  // Cut removes the originals (and their connector) and keeps them on the clipboard.
  await page.waitForTimeout(350);
  await page.mouse.click(400, 300);
  await page.keyboard.down("Shift");
  await page.mouse.click(800, 300);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Control+x");
  await expect(list(page)).toHaveCount(3);

  // Another board: paste brings the notes and the attached connector.
  await newBoard(page);
  await expect(list(page)).toHaveCount(0);
  await page.mouse.move(700, 450);
  await page.keyboard.press("Control+v");
  await expect(list(page)).toHaveText(["Стикер: Причина", "Стикер: Следствие", "Линия между объектами"]);
  check();
});

test("frames panel: lists frames in reading order, click brings a frame into view, rename in place", async ({ page }) => {
  const check = guard(page);
  await start(page);
  await page.keyboard.press("f");
  await page.mouse.click(1000, 700);
  await page.keyboard.press("Escape");
  await page.keyboard.press("f");
  await page.mouse.click(500, 300);
  await page.keyboard.press("Escape");
  await expect(list(page).filter({ hasText: "Рамка" })).toHaveCount(2);

  await page.getByRole("button", { name: "Рамки" }).click();
  const panel = page.getByRole("complementary", { name: "Рамки" });
  await expect(panel).toBeVisible();
  const rows = panel.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await panel.getByRole("button", { name: "Переименовать: Рамка без названия" }).first().click();
  await panel.getByLabel("Название рамки").fill("Начало");
  await page.keyboard.press("Enter");
  await panel.getByRole("button", { name: "Переименовать: Рамка без названия" }).click();
  await panel.getByLabel("Название рамки").fill("Итоги");
  await page.keyboard.press("Enter");
  // Top-to-bottom order: the frame placed higher comes first.
  await expect(rows).toHaveText([/Начало/, /Итоги/]);
  await expect(list(page).filter({ hasText: "Рамка:" })).toHaveText(["Рамка: Итоги", "Рамка: Начало"]);

  // Clicking a frame fits it into view and selects it.
  await panel.getByRole("button", { name: "Показать: Итоги" }).click();
  await expect(panel.getByRole("button", { name: "Показать: Итоги" })).toHaveAttribute("aria-current", "true");
  // Escape closes the panel and gives focus back to its button.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Рамки" })).toBeFocused();
  check();
});
