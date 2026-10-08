import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { data, type User } from "./data";
import { sign, verify } from "./token";
import { devSignInEnabled, supabaseAuthEnabled } from "./auth-config";
import { supabaseServer } from "./supabase/server";

// Two ways in: Supabase Auth (magic link, Google) and the development sign-in, which signs its own cookie.
// Callers only use these functions.
const COOKIE = "mysl_session";
const WEEK = 60 * 60 * 24 * 7;

export async function startSession(user: User) {
  (await cookies()).set(COOKIE, sign({ userId: user.id }, WEEK), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
  if (supabaseAuthEnabled()) await (await supabaseServer()).auth.signOut();
}

// Once per request: a page and its metadata both ask, and each answer costs a database round trip.
export const currentUser = cache(async (): Promise<User | null> => {
  if (devSignInEnabled()) {
    const claims = verify<{ userId: string }>((await cookies()).get(COOKIE)?.value);
    if (claims) return data.getUser(claims.userId);
  }
  if (supabaseAuthEnabled()) {
    // getClaims() verifies the token's signature (with the project's public keys, or by asking Supabase when
    // the project still signs with a shared secret) rather than trusting the cookie.
    const { data: auth } = await (await supabaseServer()).auth.getClaims();
    const id = auth?.claims?.sub;
    if (id) return data.getUser(id);
  }
  return null;
});

export async function requireUser(next?: string): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
