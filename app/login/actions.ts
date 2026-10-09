"use server";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { data } from "@/lib/data";
import { startSession, endSession } from "@/lib/session";
import { devSignInEnabled } from "@/lib/auth-config";
import { emailConfigured, loginEmail, sendEmail } from "@/lib/email";
import { safeNext } from "@/lib/safe-next";

export type LoginState = { error?: "email" | "send" | "off" | "consent" | "tooMany"; sent?: string; devLink?: string; email?: string; consent?: boolean } | undefined;

const devSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(80),
  next: z.string().optional(),
});

/** Development sign-in: no password, no email. Off in production unless DEV_SIGN_IN=1. */
export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  if (!devSignInEnabled()) return { error: "off" };
  const parsed = devSchema.safeParse({ email: form.get("email"), name: form.get("name") ?? "", next: form.get("next") ?? undefined });
  if (!parsed.success) return { error: "email" };
  const user = await data.upsertUserByEmail(parsed.data.email, parsed.data.name);
  await startSession(user);
  redirect(safeNext(parsed.data.next));
}

// The link goes into someone's inbox, so its address must not come from the request in production:
// a forged Host header would otherwise send the secret to someone else's site.
async function origin() {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL is not set");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Sends a one-time sign-in link. The account is created when the link is first used. */
export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  // React clears the form after each submit: what was typed comes back with the error.
  const typed = { email: String(form.get("email") ?? "").slice(0, 200), consent: form.get("consent") === "yes" };
  if (!typed.consent) return { error: "consent", ...typed };
  const email = z.string().trim().toLowerCase().email().max(200).safeParse(typed.email);
  if (!email.success) return { error: "email", ...typed };
  const mailOn = emailConfigured();
  // In production a link that cannot be sent is useless; in development it is shown on the page instead.
  if (!mailOn && process.env.NODE_ENV === "production") return { error: "off", ...typed };

  const token = randomBytes(32).toString("base64url");
  if ((await data.createLoginLink(email.data, hash(token), safeNext(form.get("next") as string | null))) === "too_many") return { error: "tooMany", ...typed };
  const url = `${await origin()}/auth/link?t=${token}`;
  if (!mailOn) return { sent: email.data, devLink: url };
  if ((await sendEmail(loginEmail({ to: email.data, url }))) !== "sent") return { error: "send", ...typed };
  return { sent: email.data };
}

/** The button on /auth/link: uses up the link and signs in. Mail scanners that open links do not press it. */
export async function finishSignIn(form: FormData) {
  const token = form.get("t");
  const link = typeof token === "string" && token.length >= 40 ? await data.useLoginLink(hash(token)) : null;
  if (!link) redirect("/login?error=link");
  const user = await data.upsertUserByEmail(link.email, "");
  await startSession(user);
  redirect(safeNext(link.next));
}

export async function signOut() {
  await endSession();
  redirect("/login");
}
