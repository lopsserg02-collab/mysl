import { test, expect } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { boardReady, guard, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);
const items = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Объекты на доске" }).getByRole("listitem");

/** A real w×h PNG, built here so the test needs no fixture files. */
function png(w: number, h: number): Buffer {
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

test("images: pick a file, it keeps its proportions, survives reload, and only people on the board can load it", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const check = guard(page);
  await signIn(page, `img-${uniq()}@example.com`, "Ира");
  await page.getByRole("button", { name: "Новая доска" }).click();
  await page.waitForURL(/\/board\//);
  await boardReady(page);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Картинка" }).click();
  await (await chooser).setFiles({ name: "схема.png", mimeType: "image/png", buffer: png(960, 480) });
  await expect(items(page)).toHaveText(["Картинка: схема"]);

  // The file is served to the owner
  const res = await page.waitForResponse((r) => /\/api\/assets\/[0-9a-f-]{36}$/.test(r.url()));
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
