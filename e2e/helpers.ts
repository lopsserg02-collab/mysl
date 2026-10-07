import { expect, type Page } from "@playwright/test";

// Fail the test on any console error or server error, as replica-test requires.
export function guard(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/WebSocket|ERR_CONNECTION_REFUSED/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
  });
  return () => expect(problems, problems.join("\n")).toEqual([]);
}

export async function signIn(page: Page, email: string, name: string) {
  await page.goto("/login");
  // The test sign-in form; the Supabase form above it has its own email field when Supabase is configured.
  const form = page.locator("form", { has: page.getByLabel("Как вас зовут") });
  await form.getByLabel("Как вас зовут").fill(name);
  await form.getByLabel("Электронная почта").fill(email);
  await form.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Мои доски" })).toBeVisible();
}

export async function boardReady(page: Page) {
  await expect(page.getByRole("navigation", { name: "Инструменты" })).toBeVisible();
  await expect(page.locator("[data-ready]")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: /Подключаемся|Нет связи/ })).toHaveCount(0, { timeout: 15_000 });
}
