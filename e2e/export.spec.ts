import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { boardReady, guard, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);

test("F14: export the board to PNG at the chosen quality, and frames to a PDF page each", async ({ page }) => {
  const check = guard(page);
  await signIn(page, `ex-${uniq()}@example.com`, "Эля");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);
  await page.getByLabel("Название доски").fill("План/Q4");
  await page.keyboard.press("Enter");

  // Nothing to save on an empty board
  await page.getByRole("button", { name: "Экспорт" }).click();
  const dialog = page.getByRole("dialog", { name: "Экспорт доски" });
  await expect(dialog.getByText("нечего сохранять")).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть" }).click();

  // A sticky (200×200) and two frames far apart, one of them off screen
  await page.keyboard.press("n");
  await page.mouse.click(700, 450);
  await page.getByLabel("Текст стикера").fill("Идея");
  await page.keyboard.press("Escape");
  for (const [x, y] of [[300, 200], [1200, 700]]) {
    await page.mouse.click(1300, 820);
    await page.keyboard.press("f");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 150, y + 100, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
  }
  await page.mouse.click(1300, 820);
  await page.getByRole("button", { name: "Отдалить" }).click();

  // PNG of the whole board at high quality: 2 px per board unit, 40 units of margin each side
  await page.getByRole("button", { name: "Экспорт" }).click();
  await dialog.getByLabel("Высокое").check();
  const pngDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe("План Q4.png");
  const bytes = await readFile((await png.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  const width = bytes.readUInt32BE(16);
  expect(width).toBeGreaterThan((1200 + 150 - 300 + 80) * 2 * 0.9); // spans both frames, at board scale
  await expect(dialog).not.toBeVisible();

  // Frames as pages need PDF
  await page.getByRole("button", { name: "Экспорт" }).click();
  await expect(dialog.getByLabel(/Рамки, каждую/)).toBeDisabled();
  await dialog.getByLabel("Документ PDF").check();
  await dialog.getByLabel(/Рамки, каждую на своей странице \(2\)/).check();
  const pdfDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  const pdf = await readFile((await (await pdfDownload).path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
  check();
});
