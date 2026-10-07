// Email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). No SDK: one fetch.
// Without RESEND_API_KEY nothing is sent and the app works as before; the skip is logged.
import { t } from "../copy";
import type { ShareRole } from "../data/types";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendResult = "sent" | "skipped" | "failed";

const RESEND_URL = "https://api.resend.com/emails";

/** Never throws: email is a side effect, and a failed send must not fail the action that caused it. */
export async function sendEmail(mail: Email, fetcher: typeof fetch = fetch): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    console.info(`[email] ${!key ? "RESEND_API_KEY" : "EMAIL_FROM"} is not set, not sending "${mail.subject}"`);
    return "skipped";
  }
  try {
    const res = await fetcher(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "sent";
    console.error(`[email] Resend refused the message: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  } catch (e) {
    console.error(`[email] sending failed: ${(e as Error).message}`);
  }
  return "failed";
}

/** The site's public address, for links in emails. */
export function boardUrl(origin: string, boardId: string) {
  return `${origin.replace(/\/+$/, "")}/board/${boardId}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Plain and short: a few paragraphs, one link, no images or tracking.
function render(paragraphs: string[], link: { label: string; url: string }) {
  const text = [...paragraphs, `${link.label}: ${link.url}`, "—", t.email.footer].join("\n\n");
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">',
    ...paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`),
    `<p><a href="${esc(link.url)}">${esc(link.label)}</a></p>`,
    `<p style="color:#6b6b6b;font-size:13px">${esc(t.email.footer)}</p>`,
    "</div>",
  ].join("");
  return { text, html };
}

export function inviteEmail(p: { to: string; inviter: string; board: string; role: ShareRole; url: string }): Email {
  const { text, html } = render([t.email.inviteBody(p.inviter, p.board, t.email.roles[p.role]), t.email.inviteSignIn], { label: t.email.inviteLink, url: p.url });
  return { to: p.to, subject: t.email.inviteSubject(p.inviter, p.board), text, html };
}

export function mentionEmail(p: { to: string; author: string; board: string; comment: string; url: string }): Email {
  const quote = p.comment.length > 500 ? `${p.comment.slice(0, 500)}…` : p.comment;
  const { text, html } = render([t.email.mentionBody(p.author, p.board), `«${quote}»`], { label: t.email.mentionLink, url: p.url });
  return { to: p.to, subject: t.email.mentionSubject(p.author, p.board), text, html };
}
