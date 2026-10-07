"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { data, canEditBoard, type ShareRole, type User } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { checkEditorSeat } from "@/lib/billing/limits";
import { t } from "@/lib/copy";
import { boardUrl, inviteEmail, mentionEmail, sendEmail } from "@/lib/email";

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

/** A private copy of a board the user can edit, named "<name> (копия)". It shows up first in their list. */
export async function duplicateBoard(boardId: string): Promise<{ ok: true; id: string } | { ok: false }> {
  const user = await requireUser();
  const bid = id.parse(boardId);
  const [board, role] = await Promise.all([data.getBoard(bid), data.getRole(bid, user.id)]);
  if (!board || !canEditBoard(role)) return { ok: false };
  const copy = await data.duplicateBoard(user.id, bid, t.dash.copyName(board.name));
  revalidatePath("/");
  return { ok: true, id: copy.id };
}

// ---------- email (sent after the response, so a slow mail service never slows the board) ----------

async function siteOrigin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

async function emailInvite(user: User, boardId: string, email: string, role: ShareRole) {
  const [origin, board] = await Promise.all([siteOrigin(), data.getBoard(boardId)]);
  after(() => sendEmail(inviteEmail({ to: email, inviter: user.name, board: board?.name ?? t.board.untitled, role, url: boardUrl(origin, boardId) })));
}

async function emailMentions(user: User, boardId: string, comment: string, mentioned: string[]) {
  const ids = new Set(mentioned.filter((m) => m !== user.id));
  if (!ids.size) return;
  // Only people on the board can be mentioned, and the people list is where their addresses are visible.
  const [origin, board, people] = await Promise.all([siteOrigin(), data.getBoard(boardId), data.listPeople(user.id, boardId)]);
  const url = boardUrl(origin, boardId);
  const to = people.filter((p) => p.userId && ids.has(p.userId) && p.email);
  after(() => Promise.all(to.map((p) => sendEmail(mentionEmail({ to: p.email, author: user.name, board: board?.name ?? t.board.untitled, comment, url })))));
}

// ---------- notifications ----------

export async function listNotifications() {
  const user = await requireUser();
  return data.listNotifications(user.id, 50);
}

export async function unreadNotifications() {
  const user = await requireUser();
  return data.unreadNotifications(user.id);
}

export async function markNotificationsRead(ids?: string[]) {
  const user = await requireUser();
  await data.markNotificationsRead(user.id, ids === undefined ? undefined : z.array(id).max(200).parse(ids));
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
  const bid = id.parse(boardId);
  const r = shareRole.parse(role);
  if (r === "editor") {
    const full = await editorSeat(user.id, bid, { email: parsed.data });
    if (full) return full;
  }
  const key = parsed.data.toLowerCase();
  // Changing the role of someone already on the list is not a new invitation: no email for that.
  const known = (await data.listPeople(user.id, bid)).some((p) => p.email.toLowerCase() === key);
  const result = await data.shareBoard(user.id, bid, parsed.data, r);
  if (!known && key !== user.email.toLowerCase()) await emailInvite(user, bid, parsed.data, r);
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
  const bid = id.parse(boardId);
  const ids = mentions.parse(mentioned);
  const thread = await data.createThread(user.id, bid, pos, body.parse(text), ids);
  await emailMentions(user, bid, thread.comments[0].body, ids);
  return thread;
}

export async function replyToThread(threadId: string, text: string, mentioned: string[], boardId?: string) {
  const user = await requireUser();
  const ids = mentions.parse(mentioned);
  const comment = await data.replyToThread(user.id, id.parse(threadId), body.parse(text), ids);
  // The email needs the board; check the thread really is on it before taking the caller's word for it.
  if (ids.length && boardId && (await data.listThreads(user.id, id.parse(boardId))).some((th) => th.id === threadId)) {
    await emailMentions(user, boardId, comment.body, ids);
  }
  return comment;
}

export async function setThreadResolved(threadId: string, resolved: boolean) {
  const user = await requireUser();
  await data.setThreadResolved(user.id, id.parse(threadId), z.boolean().parse(resolved));
}
