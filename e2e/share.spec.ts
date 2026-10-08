import { test, expect } from "@playwright/test";
import { boardReady, guard, shareLink, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);
const expectLink = shareLink;

test("F08: invite by email before sign-up, change the role, open to everyone by link", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const check = guard(owner);
  await signIn(owner, `o-${uniq()}@example.com`, "Ольга");
  await owner.getByRole("button", { name: "Новая доска" }).click();
  await owner.waitForURL(/\/board\//);
  await boardReady(owner);
  const url = owner.url();

  // Invite someone who has no account yet
  const guestEmail = `g-${uniq()}@example.com`;
  await owner.getByRole("button", { name: "Поделиться" }).click();
  const dialog = owner.getByRole("dialog", { name: "Поделиться доской" });
  await dialog.getByLabel("Почта человека").fill(guestEmail);
  await dialog.getByLabel("Доступ", { exact: true }).selectOption("commenter");
  await dialog.getByRole("button", { name: "Пригласить" }).click();
  await expect(dialog.getByRole("status")).toContainText(`Приглашение для ${guestEmail} ждёт`);
  await expect(dialog.getByRole("listitem").filter({ hasText: guestEmail })).toContainText("ждёт входа");

  // They sign up and find the board in their list, read-only
  const guest = await (await browser.newContext()).newPage();
  await signIn(guest, guestEmail, "Гоша");
  await expect(guest.getByRole("link", { name: /Без названия/ }).first()).toBeVisible();
  await guest.goto(url);
  await boardReady(guest);
  await expect(guest.getByRole("button", { name: "Стикер (N)" })).toHaveCount(0);

  // The owner makes them an editor; on their next visit they can edit
  await owner.reload();
  await boardReady(owner);
  await owner.getByRole("button", { name: "Поделиться" }).click();
  await dialog.getByLabel("Доступ для Гоша").selectOption("editor");
  await expect(dialog.getByLabel("Доступ для Гоша")).toHaveValue("editor");
  await guest.reload();
  await boardReady(guest);
  await expect(guest.getByRole("button", { name: "Стикер (N)" })).toBeVisible();

  // A stranger cannot open the board until the link is opened up
  const stranger = await (await browser.newContext()).newPage();
  await signIn(stranger, `s-${uniq()}@example.com`, "Света");
  await stranger.goto(url);
  await expect(stranger.getByRole("heading", { name: "Эта доска недоступна" })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Доступ по ссылке" }).selectOption("view");
  await expect(dialog.getByText("только тот, кто вошёл")).toBeVisible();
  // The link carries the board's secret; the board's address alone still opens nothing.
  const link = await expectLink(dialog);
  await stranger.reload();
  await expect(stranger.getByRole("heading", { name: "Эта доска недоступна" })).toBeVisible();
  // The setting saves in the background; the stranger's visit by link gets in once it has.
  await expect(async () => {
    await stranger.goto(link);
    await expect(stranger.getByRole("navigation", { name: "Инструменты" })).toBeVisible({ timeout: 2000 });
  }).toPass();
  // Joined: the secret leaves the address bar.
  await expect(stranger).toHaveURL(url);
  await boardReady(stranger);
  await expect(stranger.getByRole("button", { name: "Стикер (N)" })).toHaveCount(0);
  // Viewers see who is on the board but cannot change it
  await stranger.getByRole("button", { name: "Поделиться" }).click();
  const theirs = stranger.getByRole("dialog", { name: "Поделиться доской" });
  await expect(theirs.getByRole("listitem")).toHaveCount(3);
  await expect(theirs.getByLabel("Почта человека")).toHaveCount(0);
  await expect(theirs.getByRole("combobox", { name: "Доступ по ссылке" })).toBeDisabled();

  // Closing the link and removing someone takes the board away (server actions run in order,
  // so the link is private by the time the removal shows in the list)
  await dialog.getByRole("combobox", { name: "Доступ по ссылке" }).selectOption("private");
  await dialog.getByRole("button", { name: "Убрать с доски: Гоша" }).click();
  await expect(dialog.getByRole("listitem").filter({ hasText: "Гоша" })).toHaveCount(0);
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Эта доска недоступна" })).toBeVisible();
  check();
});
