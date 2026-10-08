import { test, expect } from "@playwright/test";
import { boardReady, guard, png, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);
const items = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");

test("images: pick a file, it keeps its proportions, survives reload, and only people on the board can load it", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const check = guard(page);
  await signIn(page, `img-${uniq()}@example.com`, "Ира");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);

  // Listen before uploading: the picture can load before the item shows in the list.
  const served = page.waitForResponse((r) => /\/api\/assets\/[0-9a-f-]{36}$/.test(r.url()));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Картинка" }).click();
  await (await chooser).setFiles({ name: "схема.png", mimeType: "image/png", buffer: png(960, 480) });
  await expect(items(page)).toHaveText(["Картинка: схема"]);

  // The file is served to the owner
  const res = await served;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const src = res.url();

  // A file that only pretends to be an image is refused
  const chooser2 = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Картинка" }).click();
  await (await chooser2).setFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
  await expect(page.getByRole("status").filter({ hasText: "Подходят только PNG" })).toBeVisible();
  await expect(items(page)).toHaveCount(1);

  await page.reload();
  await boardReady(page);
  await expect(items(page)).toHaveText(["Картинка: схема"]);

  // Someone without access gets nothing
  const other = await (await browser.newContext()).newPage();
  await signIn(other, `x-${uniq()}@example.com`, "Чужой");
  expect((await other.request.get(src)).status()).toBe(404);
  expect((await (await browser.newContext()).request.get(src)).status()).toBe(401);
  check();
});
