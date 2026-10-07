import "server-only";
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

export async function currentUser(): Promise<User | null> {
  if (devSignInEnabled()) {
    const claims = verify<{ userId: string }>((await cookies()).get(COOKIE)?.value);
    if (claims) return data.getUser(claims.userId);
  }
  if (supabaseAuthEnabled()) {
    // getUser() checks the token with Supabase rather than trusting the cookie.
    const { data: auth } = await (await supabaseServer()).auth.getUser();
    if (auth.user) return data.getUser(auth.user.id);
  }
  return null;
}

export async function requireUser(next?: string): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
