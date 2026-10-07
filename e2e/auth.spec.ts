import { test, expect } from "@playwright/test";
import { guard } from "./helpers";

// Runs only when Supabase Auth is configured (NEXT_PUBLIC_SUPABASE_URL and DATA_LAYER=postgres).
test("Google sign-in hands off to Supabase and returns to /auth/callback", async ({ page }) => {
  const check = guard(page);
  await page.goto("/login?next=/");
  const google = page.getByRole("button", { name: "Войти через Google" });
  test.skip((await google.count()) === 0, "Supabase Auth is not configured");
  // Stop at Supabase's door: no request leaves the test machine.
  let authorize: URL | null = null;
  await page.route(/\/auth\/v1\/authorize/, (route) => {
    authorize = new URL(route.request().url());
    return route.fulfill({ status: 200, body: "ok" });
  });
  await google.click();
  await expect.poll(() => authorize?.searchParams.get("provider")).toBe("google");
  const back = new URL(authorize!.searchParams.get("redirect_to")!);
  expect(back.pathname).toBe("/auth/callback");
  expect(back.searchParams.get("next")).toBe("/");
  check();
});

test("an expired sign-in link explains itself", async ({ page }) => {
  await page.goto("/auth/callback?code=not-a-real-code");
  await expect(page).toHaveURL(/\/login\?error=link/);
  await expect(page.getByRole("alert").filter({ hasText: "Ссылка устарела" })).toBeVisible();
});
