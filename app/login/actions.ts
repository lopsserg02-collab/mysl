"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { data } from "@/lib/data";
import { startSession, endSession } from "@/lib/session";
import { devSignInEnabled, supabaseAuthEnabled } from "@/lib/auth-config";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export type LoginState = { error?: "email" | "send" | "off" | "consent"; sent?: string } | undefined;

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

async function callbackUrl(next: string | null) {
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

/** Sends a one-time sign-in link. The account is created on first use. */
export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  if (!supabaseAuthEnabled()) return { error: "off" };
  if (form.get("consent") !== "yes") return { error: "consent" };
  const email = z.string().trim().toLowerCase().email().max(200).safeParse(form.get("email"));
  if (!email.success) return { error: "email" };
  const { error } = await (await supabaseServer()).auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: await callbackUrl(form.get("next") as string | null) },
  });
  if (error) return { error: "send" };
  return { sent: email.data };
}

export async function signInWithGoogle(form: FormData) {
  if (!supabaseAuthEnabled()) redirect("/login");
  if (form.get("consent") !== "yes") redirect("/login?error=consent");
  const { data: res, error } = await (await supabaseServer()).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: await callbackUrl(form.get("next") as string | null) },
  });
  if (error || !res.url) redirect("/login?error=google");
  redirect(res.url);
}

export async function signOut() {
  await endSession();
  redirect("/login");
}
