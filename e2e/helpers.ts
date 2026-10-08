import { deflateSync } from "node:zlib";
import { expect, type Locator, type Page } from "@playwright/test";

/** The board link shown in the open share dialog: the board's address plus its secret. */
export async function shareLink(dialog: Locator): Promise<string> {
  const field = dialog.getByLabel("Ссылка на доску");
  await expect(field).toHaveValue(/\/board\/[0-9a-f-]{36}\?k=[0-9a-f]{32}$/);
  return field.inputValue();
}

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
  await expect(page.getByRole("status").filter({ hasText: /Подключаемся|Нет сети/ })).toHaveCount(0, { timeout: 15_000 });
}

/** A real w×h PNG, built here so the test needs no fixture files. */
export function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x3c)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
