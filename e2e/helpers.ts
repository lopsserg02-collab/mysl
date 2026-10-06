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
  await page.getByLabel("Как вас зовут").fill(name);
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("heading", { name: "Мои доски" })).toBeVisible();
}

export async function boardReady(page: Page) {
  await expect(page.getByRole("navigation", { name: "Инструменты" })).toBeVisible();
  await expect(page.locator("[data-ready]")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: /Подключаемся|Нет связи/ })).toHaveCount(0, { timeout: 15_000 });
}
