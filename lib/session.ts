import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { data, type User } from "./data";
import { sign, verify } from "./token";

// Development sign-in. Supabase Auth replaces this in the replica-backend stage; callers only use these functions.
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
}

export async function currentUser(): Promise<User | null> {
  const claims = verify<{ userId: string }>((await cookies()).get(COOKIE)?.value);
  return claims ? data.getUser(claims.userId) : null;
}

export async function requireUser(next?: string): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
