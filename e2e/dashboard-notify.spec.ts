import { test, expect, type Page } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);

async function newBoard(page: Page, name: string) {
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
  const title = page.getByLabel("Название доски");
  await title.fill(name);
  await title.press("Enter");
  return page.url();
}

const card = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });

test("dashboard: duplicate a board with its content, trash shows days left", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const check = guard(page);
  await signIn(page, `d-${uniq()}@example.com`, "Дина");
  await newBoard(page, "Ретро");
  await page.keyboard.press("n");
  await page.mouse.click(720, 450);
  await page.getByLabel("Текст стикера").fill("Что улучшить");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("list", { name: "Объекты на доске" })).toContainText("Что улучшить");
  // Leaving the board makes the realtime server store it
  await page.waitForTimeout(1500);
  await page.getByRole("link", { name: "Все доски" }).click();
  await expect(page.getByRole("heading", { name: "Мои доски" })).toBeVisible();

  await card(page, "Ретро").getByRole("button", { name: "Действия с доской" }).click();
  await page.getByRole("menuitem", { name: "Дублировать" }).click();
  await expect(page.getByRole("link", { name: "Ретро (копия)", exact: true })).toBeVisible();

  // The copy has the original's content and is its own board
  await page.getByRole("link", { name: "Ретро (копия)", exact: true }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
  await expect(page.getByLabel("Название доски")).toHaveValue("Ретро (копия)");
  await expect(page.getByRole("list", { name: "Объекты на доске" })).toContainText("Что улучшить");
  await page.getByRole("link", { name: "Все доски" }).click();

  // Trash says when the board goes for good
  await card(page, "Ретро").getByRole("button", { name: "Действия с доской" }).click();
  await page.getByRole("menuitem", { name: "В корзину" }).click();
  await expect(page.getByRole("link", { name: "Ретро", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Корзина" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Ретро" })).toContainText("Удалится через 30 дней");
  check();
});

test("notifications: invite and @mention reach the bell, mark read, open the board", async ({ browser }) => {
  const boris = await (await browser.newContext()).newPage();
  const checkB = guard(boris);
  const borisEmail = `b-${uniq()}@example.com`;
  await signIn(boris, borisEmail, "Борис");
  await expect(boris.getByRole("button", { name: "Уведомления", exact: true })).toBeVisible();

  const anna = await (await browser.newContext()).newPage();
  const checkA = guard(anna);
  await signIn(anna, `a-${uniq()}@example.com`, "Анна");
  const url = await newBoard(anna, "Запуск");
  await anna.getByRole("button", { name: "Поделиться" }).click();
  const share = anna.getByRole("dialog", { name: "Поделиться доской" });
  await share.getByLabel("Почта человека").fill(borisEmail);
  await share.getByRole("button", { name: "Пригласить" }).click();
  await expect(share.getByRole("status")).toContainText("теперь на доске");
  await share.getByRole("button", { name: "Закрыть" }).click();

  // A comment on the canvas that mentions Борис
  await anna.mouse.click(1300, 800);
  await anna.keyboard.press("c");
  await anna.mouse.click(600, 400);
  const box = anna.getByRole("combobox", { name: /Напишите комментарий/ });
  await box.pressSequentially("Посмотри, @Бо");
  await expect(anna.getByRole("option", { name: /Борис/ })).toBeVisible();
  await anna.keyboard.press("Enter");
  await anna.keyboard.press("Enter");
  await expect(anna.getByRole("button", { name: /^Комментарий Анна: Посмотри/ })).toBeVisible();
  // Anna's own bell stays quiet
  await expect(anna.getByRole("button", { name: "Уведомления", exact: true })).toBeVisible();

  // Борис sees both on his dashboard
  await boris.reload();
  const bell = boris.getByRole("button", { name: "Уведомления, непрочитанных: 2" });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = boris.getByRole("dialog", { name: "Уведомления" });
  const items = panel.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Анна упоминает вас на доске «Запуск»");
  await expect(items.nth(0)).toContainText("Посмотри, @Борис");
  await expect(items.nth(1)).toContainText("Анна добавляет вас на доску «Запуск»");

  // Opening one marks it read and goes to the board, where the bell is in the header too
  await items.nth(0).getByRole("button").click();
  await boris.waitForURL(url);
  await boardReady(boris);
  const boardBell = boris.getByRole("button", { name: "Уведомления, непрочитанных: 1" });
  await expect(boardBell).toBeVisible();
  await boardBell.click();
  await boris.getByRole("dialog", { name: "Уведомления" }).getByRole("button", { name: "Прочитать все" }).click();
  await expect(boris.getByRole("button", { name: "Уведомления", exact: true })).toBeVisible();

  // Read state is saved (the server action finishes in the background, so allow a retry)
  await expect(async () => {
    await boris.goto("/");
    await expect(boris.getByRole("button", { name: "Уведомления", exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass();
  checkA();
  checkB();
});

test("trash purge job refuses requests without the cron secret", async ({ request }) => {
  expect([401, 503]).toContain((await request.get("/api/cron/purge")).status());
  expect([401, 503]).toContain((await request.get("/api/cron/purge", { headers: { Authorization: "Bearer wrong" } })).status());
});
