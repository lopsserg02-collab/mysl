import { test, expect } from "@playwright/test";
import { guard } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 10);

// Without mail configured (development), the page shows the link instead of sending it.
test("sign-in by email link: consent first, the link works once and keeps the destination", async ({ page }) => {
  const check = guard(page);
  await page.goto("/login?next=/pricing");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Получить ссылку" }) });
  await form.getByLabel("Электронная почта").fill(`link-${uniq()}@example.com`);
  await form.getByRole("button", { name: "Получить ссылку" }).click();
  await expect(form.getByRole("alert")).toHaveText(/отметьте согласие/);

  await form.getByRole("checkbox", { name: /согласие на обработку персональных данных/ }).check();
  await form.getByRole("button", { name: "Получить ссылку" }).click();
  const link = page.getByRole("link", { name: "войти", exact: true });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  expect(new URL(href).pathname).toBe("/auth/link");

  // Opening the link signs nobody in by itself: mail scanners open links too.
  await page.goto(href);
  await page.goto(href);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/pricing$/);

  // Used once, it is spent.
  await page.context().clearCookies();
  await page.goto(href);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/login\?error=link/);
  await expect(page.getByRole("alert").filter({ hasText: "Ссылка устарела" })).toBeVisible();
  check();
});

test("an old sign-in link explains itself", async ({ page }) => {
  await page.goto("/auth/callback?code=not-a-real-code");
  await expect(page).toHaveURL(/\/login\?error=link/);
  await expect(page.getByRole("alert").filter({ hasText: "Ссылка устарела" })).toBeVisible();
});
