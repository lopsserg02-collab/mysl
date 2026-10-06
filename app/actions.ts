"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { data } from "@/lib/data";
import { requireUser } from "@/lib/session";

const id = z.string().uuid();

export async function createBoard() {
  const user = await requireUser();
  const board = await data.createBoard(user.id, "Без названия");
  redirect(`/board/${board.id}`);
}

export async function renameBoard(boardId: string, name: string) {
  const user = await requireUser();
  const clean = z.string().trim().min(1).max(60).parse(name);
  await data.renameBoard(user.id, id.parse(boardId), clean);
  revalidatePath("/");
}

export async function setStarred(boardId: string, starred: boolean) {
  const user = await requireUser();
  await data.setStarred(user.id, id.parse(boardId), z.boolean().parse(starred));
  revalidatePath("/");
}

export async function trashBoard(boardId: string) {
  const user = await requireUser();
  await data.trashBoard(user.id, id.parse(boardId));
  revalidatePath("/");
}

export async function restoreBoard(boardId: string) {
  const user = await requireUser();
  await data.restoreBoard(user.id, id.parse(boardId));
  revalidatePath("/");
}

// ---------- sharing (S08) ----------

const shareRole = z.enum(["editor", "commenter", "viewer"]);

export async function listPeople(boardId: string) {
  const user = await requireUser();
  return data.listPeople(user.id, id.parse(boardId));
}

export async function shareBoard(boardId: string, email: string, role: string): Promise<{ ok: true; result: "added" | "invited" } | { ok: false }> {
  const user = await requireUser();
  const parsed = z.string().trim().email().max(200).safeParse(email);
  if (!parsed.success) return { ok: false };
  const result = await data.shareBoard(user.id, id.parse(boardId), parsed.data, shareRole.parse(role));
  return { ok: true, result };
}

export async function setMemberRole(boardId: string, memberId: string, role: string | null) {
  const user = await requireUser();
  await data.setMemberRole(user.id, id.parse(boardId), id.parse(memberId), role === null ? null : shareRole.parse(role));
  revalidatePath("/");
}

export async function cancelInvite(boardId: string, email: string) {
  const user = await requireUser();
  await data.cancelInvite(user.id, id.parse(boardId), z.string().email().parse(email));
}

export async function setLinkAccess(boardId: string, access: string) {
  const user = await requireUser();
  await data.setLinkAccess(user.id, id.parse(boardId), z.enum(["private", "view", "comment", "edit"]).parse(access));
}
