import { test } from "node:test";
import assert from "node:assert/strict";
import { boardUrl, inviteEmail, mentionEmail, sendEmail } from "./index";

const mail = inviteEmail({ to: "lena@example.com", inviter: "Аня", board: "План <запуска>", role: "editor", url: boardUrl("https://mysl.example/", "b1") });

test("invite email: Russian, short, with the board link and escaped HTML", () => {
  assert.equal(mail.subject, "Аня приглашает вас на доску «План <запуска>»");
  assert.match(mail.text, /можно редактировать/);
  assert.match(mail.text, /https:\/\/mysl\.example\/board\/b1/);
  assert.match(mail.html, /href="https:\/\/mysl\.example\/board\/b1"/);
  assert.match(mail.html, /План &lt;запуска&gt;/);
  assert.ok(!mail.html.includes("<запуска>"));
});

test("mention email quotes the comment", () => {
  const m = mentionEmail({ to: "a@example.com", author: "Боря", board: "Идеи", comment: "@Аня глянь", url: "https://x/board/b2" });
  assert.equal(m.subject, "Боря упоминает вас на доске «Идеи»");
  assert.match(m.text, /«@Аня глянь»/);
  assert.match(m.text, /https:\/\/x\/board\/b2/);
});

test("without RESEND_API_KEY nothing is sent", async () => {
  delete process.env.RESEND_API_KEY;
  process.env.EMAIL_FROM = "Мысль <hello@example.com>";
  let called = false;
  const result = await sendEmail(mail, (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch);
  assert.equal(result, "skipped");
  assert.equal(called, false);
});

test("with a key, one POST to Resend with the message", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Мысль <hello@example.com>";
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await sendEmail(mail, (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  }) as unknown as typeof fetch);
  assert.equal(result, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer re_test");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.to, ["lena@example.com"]);
  assert.equal(body.from, "Мысль <hello@example.com>");
  assert.equal(body.subject, mail.subject);

  // A refusal or a network error is reported, never thrown
  assert.equal(await sendEmail(mail, (async () => new Response("bad", { status: 422 })) as unknown as typeof fetch), "failed");
  assert.equal(await sendEmail(mail, (async () => { throw new Error("offline"); }) as unknown as typeof fetch), "failed");
  delete process.env.RESEND_API_KEY;
});
