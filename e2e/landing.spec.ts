import { test, expect, type Page } from "@playwright/test";
import { guard, signIn } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);

// A dependency-free accessibility sanity check in the spirit of axe: the rules a page most often breaks.
async function a11yProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && (r.width > 0 || r.height > 0);
    };
    const name = (el: Element) =>
      (el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ") ||
        (el as HTMLElement).innerText ||
        el.getAttribute("title") ||
        Array.from(el.querySelectorAll("img[alt]")).map((i) => i.getAttribute("alt")).join(" ") ||
        "").trim();

    if (!document.documentElement.lang) problems.push("html has no lang");
    if (!document.title.trim()) problems.push("page has no title");
    if (document.querySelectorAll("main").length !== 1) problems.push("page needs exactly one <main>");
    if (document.querySelectorAll("h1").length !== 1) problems.push("page needs exactly one <h1>");
    let last = 0;
    for (const h of Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))) {
      const level = Number(h.tagName[1]);
      if (last && level > last + 1) problems.push(`heading level skips: ${h.tagName} "${h.textContent}"`);
      if (!h.textContent?.trim()) problems.push(`empty ${h.tagName}`);
      last = level;
    }
    for (const el of Array.from(document.querySelectorAll("a[href], button, summary, [role=button]"))) {
      if (visible(el) && !name(el)) problems.push(`no accessible name: ${el.outerHTML.slice(0, 80)}`);
    }
    for (const img of Array.from(document.querySelectorAll("img"))) {
      if (!img.hasAttribute("alt")) problems.push(`img without alt: ${img.src}`);
    }
    for (const el of Array.from(document.querySelectorAll("[role=img]"))) {
      if (!name(el)) problems.push("role=img without a label");
    }
    for (const input of Array.from(document.querySelectorAll("input:not([type=hidden]), select, textarea"))) {
      const id = input.id;
      const labelled = input.closest("label") || (id && document.querySelector(`label[for="${id}"]`)) || input.getAttribute("aria-label");
      if (!labelled) problems.push(`unlabelled field: ${input.outerHTML.slice(0, 80)}`);
    }
    const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
    for (const dup of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`duplicate id: ${dup}`);
    const navs = Array.from(document.querySelectorAll("nav"));
    if (navs.length > 1 && navs.some((n) => !n.getAttribute("aria-label"))) problems.push("several <nav> without labels");
    return problems;
  });
}

test("signed out, / shows the landing page with working links", async ({ page }) => {
  const check = guard(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle(/Мысль/);
  await expect(page.getByRole("heading", { level: 1, name: "Онлайн-доска, на которой спокойно думается" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Мои доски" })).toHaveCount(0);
  for (const h of ["Почему Мысль", "Как это работает", "Вопросы и ответы"]) {
    await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Тарифы" }).first()).toHaveAttribute("href", "/pricing");
  const footer = page.getByRole("navigation", { name: "Нижнее меню" });
  await expect(footer.getByRole("link", { name: "Условия использования" })).toHaveAttribute("href", "/terms");
  await expect(footer.getByRole("link", { name: "Конфиденциальность" })).toHaveAttribute("href", "/privacy");

  // FAQ answers open on click.
  const faq = page.locator("details", { hasText: "Как отменить подписку?" });
  await expect(faq.getByText("Одной кнопкой в настройках")).toBeHidden();
  await faq.getByText("Как отменить подписку?").click();
  await expect(faq.getByText("Одной кнопкой в настройках")).toBeVisible();

  // Social and search metadata.
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Онлайн-доска/);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon/);

  expect(await a11yProblems(page)).toEqual([]);

  // The main button leads to sign-in.
  await page.getByRole("link", { name: "Начать бесплатно" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  check();
});

test("signed in, / is still the dashboard", async ({ page }) => {
  const check = guard(page);
  await signIn(page, `l-${uniq()}@example.com`, "Лена");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Мои доски" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Онлайн-доска, на которой спокойно думается" })).toHaveCount(0);
  await expect(page).toHaveTitle(/Мои доски/);
  check();
});

test("draft legal pages, robots.txt and sitemap.xml", async ({ page, request }) => {
  for (const [path, title] of [["/terms", "Условия использования"], ["/privacy", "Политика конфиденциальности"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("Черновик", { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(await a11yProblems(page)).toEqual([]);
  }
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /board/");
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/pricing</loc>");
  const og = await request.get("/opengraph-image.png");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");
});
