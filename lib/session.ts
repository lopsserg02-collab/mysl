import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { data, type User } from "./data";
import { sign, verify } from "./token";

// The session is one signed cookie, set after a sign-in link (or the development sign-in) proves the address.
// Callers only use these functions.
const COOKIE = "mysl_session";
const MONTH = 60 * 60 * 24 * 30;

export async function startSession(user: User) {
  (await cookies()).set(COOKIE, sign({ userId: user.id }, MONTH), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MONTH,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

// Once per request: a page and its metadata both ask, and each answer costs a database round trip.
export const currentUser = cache(async (): Promise<User | null> => {
  const claims = verify<{ userId: string }>((await cookies()).get(COOKIE)?.value);
  return claims ? data.getUser(claims.userId) : null;
});

export async function requireUser(next?: string): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
