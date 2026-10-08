import { test, expect } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

// The test stand runs without STRIPE_SECRET_KEY: everyone is on Free and payments say they are off.
const uniq = () => Math.random().toString(36).slice(2, 8);

test("plans: pricing is public, the billing page shows Free and explains payments are off", async ({ page }) => {
  const check = guard(page);
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Тарифы", level: 1 })).toBeVisible();
  const free = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Бесплатный" }) });
  const pro = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Pro" }) });
  await expect(free).toContainText("Доски без ограничений");
  await expect(free).toContainText("До 3 редакторов");
  await expect(free).toContainText("100 МБ");
  await expect(pro).toContainText("До 50 редакторов");
  await expect(page.getByText("Как отменить?")).toBeVisible();
  await expect(free.getByRole("link", { name: "Начать бесплатно" })).toHaveAttribute("href", "/login");

  await signIn(page, `bill-${uniq()}@example.com`, "Борис");
  await page.getByRole("link", { name: "Тариф" }).click();
  await expect(page.getByRole("heading", { name: "Тариф и оплата" })).toBeVisible();
  await expect(page.getByText("Бесплатный", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Перейти на Pro" })).toBeDisabled();
  await expect(page.getByText("Оплата пока не подключена")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отменить подписку" })).toHaveCount(0);

  await page.getByRole("link", { name: "Сравнить тарифы" }).click();
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Бесплатный" }) })).toContainText("Ваш тариф");
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Pro" }) }).getByRole("button", { name: "Перейти на Pro" })).toBeDisabled();
  check();
});

test("plans: the webhook refuses calls while Stripe is not configured", async ({ request }) => {
  const res = await request.post("/api/stripe/webhook", { data: "{}", headers: { "stripe-signature": "t=1,v1=00" } });
  expect(res.status()).toBe(503);
});

test("plans: a Free board takes 3 editors; the 4th is refused with a link to the plans, viewers still fit", async ({ page }) => {
  const check = guard(page);
  await signIn(page, `lim-${uniq()}@example.com`, "Лиза");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
  await page.getByRole("button", { name: "Поделиться" }).click();
  const dialog = page.getByRole("dialog", { name: "Поделиться доской" });

  const invite = async (email: string, role: string) => {
    await dialog.getByLabel("Почта человека").fill(email);
    await dialog.getByLabel("Доступ", { exact: true }).selectOption(role);
    await dialog.getByRole("button", { name: "Пригласить" }).click();
  };
  for (let i = 1; i <= 3; i++) {
    const email = `ed${i}-${uniq()}@example.com`;
    await invite(email, "editor");
    await expect(dialog.getByRole("status")).toContainText(`Приглашение для ${email} ждёт`);
  }

  const fourth = `ed4-${uniq()}@example.com`;
  await invite(fourth, "editor");
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("не больше 3 редакторов");
  await expect(alert.getByRole("link", { name: "Посмотреть тарифы" })).toHaveAttribute("href", "/pricing");
  await expect(dialog.getByRole("listitem").filter({ hasText: fourth })).toHaveCount(0);

  await invite(fourth, "viewer");
  await expect(dialog.getByRole("status")).toContainText(`Приглашение для ${fourth} ждёт`);
  // Raising the viewer to editor hits the same limit and leaves them a viewer.
  await dialog.getByLabel(`Доступ для ${fourth}`).selectOption("editor");
  await expect(dialog.getByRole("alert")).toContainText("не больше 3 редакторов");
  await expect(dialog.getByLabel(`Доступ для ${fourth}`)).toHaveValue("viewer");
  check();
});
