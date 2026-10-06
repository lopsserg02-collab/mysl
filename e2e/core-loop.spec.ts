import { test, expect } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);

test("F01+F03: create a board, add a sticky, it syncs live to a second tab and survives reload", async ({ browser }) => {
  const email = `a-${uniq()}@example.com`;
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const checkA = guard(a);
  await signIn(a, email, "Анна");

  // Empty dashboard state
  await expect(a.getByText("Здесь пока пусто")).toBeVisible();
  await a.getByRole("button", { name: "Новая доска" }).click();
  await a.waitForURL(/\/board\//);
  await boardReady(a);
  const url = a.url();

  // Second tab of the same person (another device)
  const ctxB = await browser.newContext({ storageState: await ctxA.storageState() });
  const b = await ctxB.newPage();
  const checkB = guard(b);
  await b.goto(url);
  await boardReady(b);

  // Add a sticky with N and a click, type into it
  await a.keyboard.press("n");
  await a.mouse.click(720, 450);
  const editor = a.getByLabel("Текст стикера");
  await expect(editor).toBeFocused();
  await editor.fill("Первая мысль");
  await a.keyboard.press("Escape");

  // B sees the sticky text rendered on canvas: verify through the shared document size by checking the empty hint disappears
  await expect(b.getByText("Нажмите N и кликните по доске")).toHaveCount(0);
  // And B can open the sticky for editing and sees the same text
  await b.getByRole("button", { name: "Показать всё (Shift+1)" }).click();
  await b.mouse.dblclick(720, 450);
  await expect(b.getByLabel("Текст стикера")).toHaveValue("Первая мысль");
  await b.keyboard.press("Escape");

  // A's cursor shows up for B with A's name
  await a.mouse.move(600, 300);
  await a.mouse.move(620, 320);
  await expect(b.getByText("Анна")).toBeVisible();

  // Undo on A removes the sticky for both (one step for text, one for creation)
  await a.mouse.click(1300, 800); // deselect, focus canvas
  await a.keyboard.press("Control+z");
  await a.keyboard.press("Control+z");
  await expect(b.getByText("Нажмите N и кликните по доске")).toBeVisible();
  await a.keyboard.press("Control+Shift+z");
  await a.keyboard.press("Control+Shift+z");
  await expect(b.getByText("Нажмите N и кликните по доске")).toHaveCount(0);

  // Reload keeps it (persisted on the server)
  await b.reload();
  await boardReady(b);
  await b.mouse.dblclick(720, 450);
  await expect(b.getByLabel("Текст стикера")).toHaveValue("Первая мысль");

  checkA();
  checkB();
  await ctxA.close();
  await ctxB.close();
});

test("a second user cannot open someone else's board", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await signIn(a, `owner-${uniq()}@example.com`, "Владелец");
  await a.getByRole("button", { name: "Новая доска" }).click();
  await a.waitForURL(/\/board\//);
  const url = a.url();

  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signIn(b, `other-${uniq()}@example.com`, "Чужой");
  await b.goto(url);
  await expect(b.getByRole("heading", { name: "Эта доска недоступна" })).toBeVisible();
  const res = await b.request.post("/api/realtime-token", { data: { boardId: url.split("/").pop() } });
  expect(res.status()).toBe(403);
  await ctxA.close();
  await ctxB.close();
});

test("dashboard: rename, star, trash and restore", async ({ page }) => {
  const check = guard(page);
  await signIn(page, `d-${uniq()}@example.com`, "Дима");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  const name = page.getByLabel("Название доски");
  await name.fill("План запуска");
  await name.press("Enter");
  await page.getByRole("link", { name: "Все доски" }).click();
  await expect(page.getByRole("link", { name: "План запуска" })).toBeVisible();

  await page.getByRole("button", { name: "В избранное" }).click();
  await page.getByRole("link", { name: "Избранные" }).click();
  await expect(page.getByRole("link", { name: "План запуска" })).toBeVisible();

  await page.getByRole("link", { name: "Все" , exact: true }).click();
  await page.getByRole("button", { name: "Действия с доской" }).click();
  await page.getByRole("menuitem", { name: "В корзину" }).click();
  await expect(page.getByText("Здесь пока пусто")).toBeVisible();
  await page.getByRole("link", { name: "Корзина" }).click();
  await page.getByRole("button", { name: "Действия с доской" }).click();
  await page.getByRole("menuitem", { name: "Восстановить" }).click();
  await expect(page.getByText("Корзина пуста", { exact: false })).toBeVisible();
  check();
});
