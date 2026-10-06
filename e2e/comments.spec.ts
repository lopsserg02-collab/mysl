import { test, expect } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);

test("F09: pin a comment on a sticky, mention someone, they reply live, resolve hides it", async ({ browser }) => {
  // The commenter has an account first, so the owner can add and mention them
  const kostya = await (await browser.newContext()).newPage();
  const checkK = guard(kostya);
  const kostyaEmail = `k-${uniq()}@example.com`;
  await signIn(kostya, kostyaEmail, "Костя");

  const owner = await (await browser.newContext()).newPage();
  const checkO = guard(owner);
  await signIn(owner, `o-${uniq()}@example.com`, "Ольга");
  await owner.getByRole("button", { name: "Новая доска" }).click();
  await owner.waitForURL(/\/board\//);
  await boardReady(owner);
  await owner.getByRole("button", { name: "Поделиться" }).click();
  const share = owner.getByRole("dialog", { name: "Поделиться доской" });
  await share.getByLabel("Почта человека").fill(kostyaEmail);
  await share.getByLabel("Доступ", { exact: true }).selectOption("commenter");
  await share.getByRole("button", { name: "Пригласить" }).click();
  await expect(share.getByRole("status")).toContainText("теперь на доске");
  await share.getByRole("button", { name: "Закрыть" }).click();

  // A sticky to talk about
  await owner.keyboard.press("n");
  await owner.mouse.click(700, 450);
  await owner.getByLabel("Текст стикера").fill("Идея");
  await owner.keyboard.press("Escape");

  await kostya.goto(owner.url());
  await boardReady(kostya);
  await expect(kostya.getByRole("button", { name: "Комментарий (C)" })).toBeVisible();

  // C, click the sticky, write with an @mention picked from the list
  await owner.mouse.click(1300, 800);
  await owner.keyboard.press("c");
  await owner.mouse.click(720, 470);
  const box = owner.getByRole("combobox", { name: /Напишите комментарий/ });
  await expect(box).toBeFocused();
  await box.pressSequentially("Что скажешь, @Ко");
  await expect(owner.getByRole("option", { name: /Костя/ })).toBeVisible();
  await owner.keyboard.press("Enter");
  await expect(box).toHaveValue("Что скажешь, @Костя ");
  await owner.keyboard.press("Enter");
  const pinO = owner.getByRole("button", { name: /^Комментарий Ольга: Что скажешь/ });
  await expect(pinO).toBeVisible();

  // Костя sees it without reloading, opens it and replies
  const pinK = kostya.getByRole("button", { name: /^Комментарий Ольга: Что скажешь/ });
  await expect(pinK).toBeVisible();
  await pinK.click();
  await expect(kostya.getByRole("dialog", { name: "Обсуждение" }).getByText("Что скажешь,")).toBeVisible();
  await kostya.getByRole("combobox", { name: /Ответить/ }).fill("Давай сделаем");
  await kostya.keyboard.press("Enter");
  await expect(kostya.getByRole("dialog", { name: "Обсуждение" }).getByText("Давай сделаем")).toBeVisible();
  await kostya.getByRole("dialog", { name: "Обсуждение" }).getByRole("button", { name: "Закрыть" }).click();

  // The reply reaches Ольга live; the pin follows the sticky when it moves
  await expect(pinO).toHaveText("2");
  await owner.mouse.click(1300, 800); // closes the thread
  await expect(owner.getByRole("dialog", { name: "Обсуждение" })).toHaveCount(0);
  const before = await pinO.boundingBox();
  await owner.mouse.move(700, 450);
  await owner.mouse.down();
  await owner.mouse.move(800, 500, { steps: 5 });
  await owner.mouse.up();
  await expect.poll(async () => (await pinO.boundingBox())!.x - before!.x).toBeGreaterThan(60);

  // Resolving hides the pin for everyone and offers to show resolved ones
  await pinO.click();
  await owner.getByRole("dialog", { name: "Обсуждение" }).getByRole("button", { name: "Решено" }).click();
  await expect(pinO).toHaveCount(0);
  await expect(pinK).toHaveCount(0);
  await owner.getByRole("button", { name: /Показать решённые \(1\)/ }).click();
  await expect(owner.getByRole("button", { name: /Комментарий Ольга: .*решён/ })).toBeVisible();
  checkO();
  checkK();
});
