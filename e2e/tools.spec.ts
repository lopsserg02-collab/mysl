import { test, expect, type Page } from "@playwright/test";
import { boardReady, guard, signIn } from "./helpers";

const list = (p: Page) => p.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");

async function newBoard(page: Page) {
  await signIn(page, `t-${Math.random().toString(36).slice(2, 8)}@example.com`, "Тест");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
}

test("text, shape with text, connector attaches to both shapes and is removed with them", async ({ page }) => {
  const check = guard(page);
  await newBoard(page);

  await page.keyboard.press("t");
  await page.mouse.click(300, 200);
  await page.getByLabel("Текст", { exact: true }).fill("Заголовок");
  await page.keyboard.press("Escape");
  await expect(list(page)).toHaveText(["Текст: Заголовок"]);

  // Draw a shape by dragging
  await page.keyboard.press("s");
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(560, 500, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel("Текст фигуры").fill("Идея");
  await page.keyboard.press("Escape");

  // A second shape by click
  await page.keyboard.press("s");
  await page.mouse.click(900, 450);
  await page.keyboard.press("Escape");

  // Connect the two shapes
  await page.keyboard.press("l");
  await page.mouse.move(480, 450);
  await page.mouse.down();
  await page.mouse.move(700, 450, { steps: 4 });
  await page.mouse.move(900, 450, { steps: 4 });
  await page.mouse.up();
  await expect(list(page).filter({ hasText: "Линия между объектами" })).toHaveCount(1);

  // Deleting a shape removes its connector
  await page.mouse.click(900, 450);
  await page.keyboard.press("Delete");
  await expect(list(page).filter({ hasText: "Линия" })).toHaveCount(0);
  await expect(list(page)).toHaveCount(2);
  check();
});

test("pen draws, eraser erases, frame wraps the selection, lock blocks delete", async ({ page }) => {
  const check = guard(page);
  await newBoard(page);

  await page.keyboard.press("p");
  await page.mouse.move(300, 300);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(300 + i * 20, 300 + (i % 2) * 30);
  await page.mouse.up();
  await expect(list(page)).toHaveText(["Рисунок, толщина 3"]);

  await page.keyboard.press("e");
  await page.mouse.move(250, 320);
  await page.mouse.down();
  await page.mouse.move(520, 310, { steps: 20 });
  await page.mouse.up();
  await expect(list(page)).toHaveCount(0);

  await page.keyboard.press("n");
  await page.mouse.click(700, 450);
  await page.getByLabel("Текст стикера").fill("Внутри");
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 450);
  await page.keyboard.press("f");
  await expect(list(page).filter({ hasText: "Рамка" })).toHaveCount(1);

  // Lock the sticky; delete does nothing (wait so the click is not read as a double click)
  await page.waitForTimeout(500);
  await page.mouse.click(700, 450);
  await page.keyboard.press("Control+Shift+l");
  await expect(list(page).filter({ hasText: "закреплено" })).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect(list(page).filter({ hasText: "Стикер" })).toHaveCount(1);
  check();
});
