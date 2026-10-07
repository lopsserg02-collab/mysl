// Plan limits, checked on the server before sharing and uploads. The board owner's plan applies.
// Lowering a plan never removes anything: people and files already on a board stay; only new ones wait.
import { effectivePlan, type Plan } from "../plans";
import type { BoardUsage, DataLayer } from "../data/types";
import { billingEnabled } from "./stripe";

export type LimitCheck = { ok: true; plan: Plan } | { ok: false; plan: Plan; reason: "editors" | "storage" };

export const planOf = (usage: BoardUsage) => effectivePlan(usage.ownerSubscription, billingEnabled());

/**
 * May this person become an editor of the board? Someone who already edits it (or has a pending
 * editor invite) does not take a new seat. Pass the person's email, or their user id, or both.
 */
export async function checkEditorSeat(data: DataLayer, boardId: string, who: { email?: string; userId?: string }): Promise<LimitCheck> {
  const usage = await data.boardUsage(boardId);
  if (!usage) return { ok: true, plan: effectivePlan(null, false) };
  const plan = planOf(usage);
  if (who.userId === usage.ownerId) return { ok: true, plan };
  const email = who.email?.trim().toLowerCase();
  const already = usage.editors.some((e) => (who.userId && e.userId === who.userId) || (email && e.email === email));
  if (already || usage.editors.length < plan.editorsPerBoard) return { ok: true, plan };
  return { ok: false, plan, reason: "editors" };
}

/** May this many more bytes be uploaded to the board? */
export async function checkStorage(data: DataLayer, boardId: string, bytes: number): Promise<LimitCheck & { used: number }> {
  const usage = await data.boardUsage(boardId);
  if (!usage) return { ok: true, plan: effectivePlan(null, false), used: 0 };
  const plan = planOf(usage);
  if (usage.storageBytes + bytes <= plan.storageBytes) return { ok: true, plan, used: usage.storageBytes };
  return { ok: false, plan, reason: "storage", used: usage.storageBytes };
}
