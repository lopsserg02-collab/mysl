"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { data } from "@/lib/data";
import { startSession, endSession } from "@/lib/session";

const schema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(80),
  next: z.string().optional(),
});

export async function signIn(_prev: { error?: string } | undefined, form: FormData) {
  const parsed = schema.safeParse({ email: form.get("email"), name: form.get("name") ?? "", next: form.get("next") ?? undefined });
  if (!parsed.success) return { error: "email" };
  const user = await data.upsertUserByEmail(parsed.data.email, parsed.data.name);
  await startSession(user);
  const next = parsed.data.next;
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function signOut() {
  await endSession();
  redirect("/login");
}
