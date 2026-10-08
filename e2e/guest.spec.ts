import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { boardReady, guard, png, shareLink, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);
const rtUrl = `ws://localhost:${process.env.E2E_RT_PORT ?? 1234}`;
const items = (page: Page) => page.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");

async function tokenFor(request: APIRequestContext, boardId: string, k?: string) {
  const res = await request.post("/api/realtime-token", { data: k ? { boardId, k } : { boardId } });
  return { status: res.status(), body: res.ok() ? ((await res.json()) as { token: string; role: string }) : null };
}

/** A realtime connection from Node with a given token; resolves once synced (or rejects when refused). */
function connect(boardId: string, token: string) {
  const doc = new Y.Doc();
  return new Promise<{ doc: Y.Doc; provider: HocuspocusProvider }>((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url: rtUrl,
      name: `board:${boardId}`,
      document: doc,
      token,
      onSynced: () => resolve({ doc, provider }),
      onAuthenticationFailed: () => reject(new Error("refused")),
    });
    setTimeout(() => reject(new Error("timeout")), 10_000);
  });
}

test("guest link: not signed in, the board shows live and read-only, only with the link's secret", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const check = guard(owner);
  const ownerEmail = `gl-${uniq()}@example.com`;
  await signIn(owner, ownerEmail, "Ольга");
  await owner.getByRole("button", { name: "Новая доска" }).click();
  await owner.waitForURL(/\/board\//);
  await boardReady(owner);
  const url = owner.url();
  const boardId = url.split("/").pop()!;

  // A sticky and a picture on the board
  await owner.keyboard.press("n");
  await owner.mouse.click(500, 450);
  await owner.getByLabel("Текст стикера").fill("Для гостей");
  await owner.keyboard.press("Escape");
  const served = owner.waitForResponse((r) => /\/api\/assets\/[0-9a-f-]{36}$/.test(r.url()));
  const chooser = owner.waitForEvent("filechooser");
  await owner.getByRole("button", { name: "Картинка" }).click();
  await (await chooser).setFiles({ name: "схема.png", mimeType: "image/png", buffer: png(200, 100) });
  const asset = (await served).url();

  // Another board of the same owner, with an image of its own, never shared
  const otherCtx = await browser.newContext({ storageState: await ownerCtx.storageState() });
  const ownerOther = await otherCtx.newPage();
  await ownerOther.goto("/");
  await ownerOther.getByRole("button", { name: "Новая доска" }).click();
  await ownerOther.waitForURL(/\/board\//);
  await boardReady(ownerOther);
  const otherServed = ownerOther.waitForResponse((r) => /\/api\/assets\/[0-9a-f-]{36}$/.test(r.url()));
  const otherChooser = ownerOther.waitForEvent("filechooser");
  await ownerOther.getByRole("button", { name: "Картинка" }).click();
  await (await otherChooser).setFiles({ name: "тайна.png", mimeType: "image/png", buffer: png(50, 50) });
  const otherAsset = (await otherServed).url();

  // Open the link to signed-in people first: guests are still out.
  await owner.getByRole("button", { name: "Поделиться" }).click();
  const dialog = owner.getByRole("dialog", { name: "Поделиться доской" });
  await dialog.getByRole("combobox", { name: "Доступ по ссылке" }).selectOption("view");
  const link = await shareLink(dialog);
  const k = new URL(link).searchParams.get("k")!;

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  const checkGuest = guard(guest);
  await expect(async () => {
    expect((await tokenFor(guestCtx.request, boardId, k)).status).toBe(401);
  }).toPass();
  await guest.goto(link);
  await expect(guest).toHaveURL(/\/login\?next=/);

  // Now let guests view
  await dialog.getByRole("checkbox", { name: "Открыть могут и гости без входа" }).check();
  await expect(dialog.getByText("Гости не видят другие доски")).toBeVisible();
  await expect(async () => {
    expect((await tokenFor(guestCtx.request, boardId, k)).status).toBe(200);
  }).toPass();
  await dialog.getByRole("button", { name: "Закрыть" }).click();

  // Without the secret, or with a wrong one, a guest gets nothing: sign-in page, no token, no images.
  await guest.goto(url);
  await expect(guest).toHaveURL(/\/login\?next=/);
  await guest.goto(`${url}?k=${"0".repeat(32)}`);
  await expect(guest).toHaveURL(/\/login\?next=/);
  await expect(guest.getByText("Для гостей")).toHaveCount(0);
  expect((await tokenFor(guestCtx.request, boardId)).status).toBe(401);
  expect((await tokenFor(guestCtx.request, boardId, "0".repeat(32))).status).toBe(401);
  expect((await tokenFor(guestCtx.request, boardId, k.toUpperCase())).status).toBe(400);
  expect((await guestCtx.request.get(asset)).status()).toBe(401);
  expect((await guestCtx.request.get(`${asset}?k=${"0".repeat(32)}`)).status()).toBe(404);
  // The secret opens its own board's images only.
  expect((await guestCtx.request.get(`${asset}?k=${k}`)).status()).toBe(200);
  expect((await guestCtx.request.get(`${otherAsset}?k=${k}`)).status()).toBe(404);
  const otherBoardId = ownerOther.url().split("/").pop()!;
  expect((await tokenFor(guestCtx.request, otherBoardId, k)).status).toBe(401);

  // With the link: the board, read-only, with the banner and a way to sign in
  await guest.goto(link);
  await boardReady(guest);
  await expect(guest.getByRole("note")).toHaveText(/Вы смотрите как гость — войдите, чтобы комментировать/);
  await expect(items(guest)).toHaveText(["Стикер: Для гостей", "Картинка: схема"]);
  await expect(guest.getByText("Только просмотр")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Стикер (N)" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: /Комментарий/ })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "Поделиться" })).toHaveCount(0);
  await expect(guest.getByLabel("Название доски")).toHaveAttribute("readonly", "");
  // No people list, no emails anywhere on the page
  expect(await guest.content()).not.toContain(ownerEmail);
  // The picture loads for the guest with the secret
  await expect.poll(() => guest.evaluate(() => [...document.images].length + performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/assets/") && e.name.includes("?k=")).length)).toBeGreaterThan(0);

  // Live: the owner's change reaches the guest; the guest shows up for the owner as «Гость»
  await owner.keyboard.press("n");
  await owner.mouse.click(900, 450);
  await owner.getByLabel("Текст стикера").fill("Новое");
  await owner.keyboard.press("Escape");
  await expect(items(guest)).toHaveCount(3);
  await guest.mouse.move(700, 500);
  await guest.mouse.move(720, 520);
  await expect(owner.getByRole("img", { name: "Гость" })).toBeVisible();

  // The realtime server refuses a guest's writes, even from a hand-made client
  const gt = (await tokenFor(guestCtx.request, boardId, k)).body!;
  expect(gt.role).toBe("viewer");
  const g = await connect(boardId, gt.token);
  const before = g.doc.getMap("items").size;
  g.doc.getMap("items").set("guest-wrote-this", new Y.Map());
  await new Promise((r) => setTimeout(r, 1500));
  const ot = (await tokenFor(owner.request, boardId)).body!;
  const o = await connect(boardId, ot.token);
  expect(o.doc.getMap("items").has("guest-wrote-this")).toBe(false);
  expect(o.doc.getMap("items").size).toBe(before);
  // A forged or other board's token is refused outright
  await expect(connect(otherBoardId, gt.token)).rejects.toThrow();
  await expect(connect(boardId, `${gt.token}x`)).rejects.toThrow();
  g.provider.destroy();
  o.provider.destroy();

  // Signing in from the banner comes back to the board, now as a member
  await guest.getByRole("note").getByRole("link", { name: "Войти" }).click();
  await expect(guest).toHaveURL(/\/login\?next=/);
  const form = guest.locator("form", { has: guest.getByLabel("Как вас зовут") });
  await form.getByLabel("Как вас зовут").fill("Гена");
  await form.getByLabel("Электронная почта").fill(`gl-g-${uniq()}@example.com`);
  await form.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(guest).toHaveURL(url);
  await boardReady(guest);
  await expect(guest.getByRole("note")).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "Поделиться" })).toBeVisible();

  // A new link stops the old one for guests
  const anon = await (await browser.newContext()).newPage();
  await owner.getByRole("button", { name: "Поделиться" }).click();
  await dialog.getByRole("button", { name: "Сделать новую ссылку" }).click();
  await expect(dialog.getByText("старая ссылка больше не работает")).toBeVisible();
  const fresh = await shareLink(dialog);
  expect(fresh).not.toBe(link);
  await anon.goto(link);
  await expect(anon).toHaveURL(/\/login\?next=/);
  expect((await anon.request.get(`${asset}?k=${k}`)).status()).toBe(404);
  await anon.goto(fresh);
  await boardReady(anon);
  await expect(anon.getByRole("note")).toBeVisible();

  check();
  checkGuest();
  await ownerCtx.close();
  await otherCtx.close();
  await guestCtx.close();
});

test("edit link: a guest without an account edits this one board live, and nothing else", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const check = guard(owner);
  await signIn(owner, `ge-${uniq()}@example.com`, "Олег");
  await owner.getByRole("button", { name: "Новая доска" }).click();
  await owner.waitForURL(/\/board\//);
  await boardReady(owner);
  const boardId = owner.url().split("/").pop()!;

  await owner.getByRole("button", { name: "Поделиться" }).click();
  const dialog = owner.getByRole("dialog", { name: "Поделиться доской" });
  await dialog.getByRole("combobox", { name: "Доступ по ссылке" }).selectOption("edit");
  await dialog.getByRole("checkbox", { name: "Открыть могут и гости без входа" }).check();
  const link = await shareLink(dialog);
  const k = new URL(link).searchParams.get("k")!;
  await expect(async () => {
    expect((await tokenFor(owner.request, boardId)).status).toBe(200);
    const anonCtx = await browser.newContext();
    const t = await tokenFor(anonCtx.request, boardId, k);
    await anonCtx.close();
    expect(t.body?.role).toBe("editor");
  }).toPass();
  await dialog.getByRole("button", { name: "Закрыть" }).click();

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  const checkGuest = guard(guest);
  await guest.goto(link);
  await boardReady(guest);
  await expect(guest.getByRole("note")).toHaveText(/Вы редактируете как гость/);
  // Only this board: no way back to a board list, no sharing, no comments, no pictures
  await expect(owner.getByRole("link", { name: "Все доски" })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Все доски" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "Поделиться" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: /Комментарий/ })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "Картинка" })).toHaveCount(0);

  // The guest adds a sticky; the owner sees it. The owner's sticky reaches the guest.
  await guest.keyboard.press("n");
  await guest.mouse.click(500, 450);
  await guest.getByLabel("Текст стикера").fill("От гостя");
  await guest.keyboard.press("Escape");
  await expect(items(owner)).toHaveText(["Стикер: От гостя"]);
  await owner.keyboard.press("n");
  await owner.mouse.click(900, 450);
  await owner.getByLabel("Текст стикера").fill("От хозяина");
  await owner.keyboard.press("Escape");
  await expect(items(guest)).toHaveCount(2);

  // Back to a view link: a guest's fresh token is read-only again
  await owner.getByRole("button", { name: "Поделиться" }).click();
  await dialog.getByRole("combobox", { name: "Доступ по ссылке" }).selectOption("comment");
  await expect(async () => {
    expect((await tokenFor(guestCtx.request, boardId, k)).body?.role).toBe("viewer");
  }).toPass();

  check();
  checkGuest();
  await ownerCtx.close();
  await guestCtx.close();
});
