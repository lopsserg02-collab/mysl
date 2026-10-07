"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { data } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { checkEditorSeat } from "@/lib/billing/limits";

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

type LimitReached = { ok: false; limit: "editors"; max: number };

// The plan limit is checked only for managers, so nobody else learns how full a board is.
async function editorSeat(userId: string, boardId: string, who: { email?: string; userId?: string }): Promise<LimitReached | null> {
  const mine = await data.getRole(boardId, userId);
  if (mine !== "owner" && mine !== "coowner") return null; // the data layer refuses it anyway
  const seat = await checkEditorSeat(data, boardId, who);
  return seat.ok ? null : { ok: false, limit: "editors", max: seat.plan.editorsPerBoard };
}

export async function shareBoard(boardId: string, email: string, role: string): Promise<{ ok: true; result: "added" | "invited" } | { ok: false } | LimitReached> {
  const user = await requireUser();
  const parsed = z.string().trim().email().max(200).safeParse(email);
  if (!parsed.success) return { ok: false };
  const board = id.parse(boardId);
  const r = shareRole.parse(role);
  if (r === "editor") {
    const full = await editorSeat(user.id, board, { email: parsed.data });
    if (full) return full;
  }
  const result = await data.shareBoard(user.id, board, parsed.data, r);
  return { ok: true, result };
}

export async function setMemberRole(boardId: string, memberId: string, role: string | null): Promise<{ ok: true } | LimitReached> {
  const user = await requireUser();
  const board = id.parse(boardId);
  const member = id.parse(memberId);
  const r = role === null ? null : shareRole.parse(role);
  if (r === "editor") {
    const full = await editorSeat(user.id, board, { userId: member });
    if (full) return full;
  }
  await data.setMemberRole(user.id, board, member, r);
  revalidatePath("/");
  return { ok: true };
}

export async function cancelInvite(boardId: string, email: string) {
  const user = await requireUser();
  await data.cancelInvite(user.id, id.parse(boardId), z.string().email().parse(email));
}

export async function setLinkAccess(boardId: string, access: string) {
  const user = await requireUser();
  await data.setLinkAccess(user.id, id.parse(boardId), z.enum(["private", "view", "comment", "edit"]).parse(access));
}

// ---------- comments (S09) ----------

const body = z.string().trim().min(1).max(5000);
const mentions = z.array(z.string().uuid()).max(50);

export async function listThreads(boardId: string) {
  const user = await requireUser();
  return data.listThreads(user.id, id.parse(boardId));
}

export async function createThread(boardId: string, at: { x: number; y: number; itemId?: string | null }, text: string, mentioned: string[]) {
  const user = await requireUser();
  const pos = z.object({ x: z.number().finite(), y: z.number().finite(), itemId: z.string().max(40).nullish() }).parse(at);
  return data.createThread(user.id, id.parse(boardId), pos, body.parse(text), mentions.parse(mentioned));
}

export async function replyToThread(threadId: string, text: string, mentioned: string[]) {
  const user = await requireUser();
  return data.replyToThread(user.id, id.parse(threadId), body.parse(text), mentions.parse(mentioned));
}

export async function setThreadResolved(threadId: string, resolved: boolean) {
  const user = await requireUser();
  await data.setThreadResolved(user.id, id.parse(threadId), z.boolean().parse(resolved));
}
