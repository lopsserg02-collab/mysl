// Small HMAC-signed tokens, shared by the web app (session cookie, realtime token) and the realtime server.
import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "dev-only-secret-change-me";

export function secret(): string {
  const s = process.env.REALTIME_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("REALTIME_SECRET is not set");
  return DEV_SECRET;
}

export function sign<T extends object>(payload: T, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export interface RealtimeClaims {
  userId: string;
  name: string;
  boardId: string;
  role: "owner" | "coowner" | "editor" | "commenter" | "viewer";
  /** Someone not signed in, viewing through the board's link: always read-only. */
  guest?: boolean;
}
