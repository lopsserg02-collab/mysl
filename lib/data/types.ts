// Shapes match replica/schema.sql so the Supabase implementation can replace the local one
// without any screen code changing.

import type { PlanId, SubscriptionStatus } from "../plans";

export type BoardRole = "owner" | "coowner" | "editor" | "commenter" | "viewer";
export type LinkAccess = "private" | "view" | "comment" | "edit";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Board {
  id: string;
  teamId: string;
  ownerId: string;
  name: string;
  description: string;
  linkAccess: LinkAccess;
  /** With link access on, people who are not signed in may also view the board through the link, read-only. */
  guestView: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BoardListItem extends Board {
  role: BoardRole;
  starred: boolean;
  lastOpenedAt: string | null;
}

export type ShareRole = "editor" | "commenter" | "viewer";

/** Someone on a board's people list: a member, or a pending invite (userId null). */
export interface Person {
  userId: string | null;
  name: string;
  email: string;
  role: BoardRole;
  pending: boolean;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

/** A comment pin. With itemId, x/y are relative to that item's top-left and the pin moves with it. */
export interface CommentThread {
  id: string;
  itemId: string | null;
  x: number;
  y: number;
  resolved: boolean;
  createdBy: string;
  createdAt: string;
  comments: Comment[];
}

export type AssetMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** An uploaded file. The bytes live in storage (local disk or Supabase Storage) under storagePath. */
export interface Asset {
  id: string;
  boardId: string;
  storagePath: string;
  mime: AssetMime;
  bytes: number;
  width: number | null;
  height: number | null;
}

export type BoardSort = "opened" | "modified" | "name";

/** A person's billing state. Written only from verified Stripe webhooks, never from the browser. */
export interface Subscription {
  userId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export type SubscriptionPatch = Partial<Omit<Subscription, "userId">>;

/** What a board uses against its owner's plan. */
export interface BoardUsage {
  ownerId: string;
  ownerSubscription: Subscription | null;
  /** Everyone besides the owner who can edit, plus pending editor invites. Emails are lower case. */
  editors: { userId: string | null; email: string }[];
  /** Bytes of all uploads on every board the owner has, trash included. */
  storageBytes: number;
}

/** Billing writes inside one Stripe event's transaction. */
export interface BillingWriter {
  userIdForCustomer(customerId: string): Promise<string | null>;
  getSubscription(userId: string): Promise<Subscription | null>;
  saveSubscription(userId: string, patch: SubscriptionPatch & { eventAt: string }): Promise<"saved" | "stale">;
}

export type NotificationKind = "mention" | "invite";

/** An in-app notification: someone mentioned you in a comment, or added you to a board. */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  boardId: string;
  boardName: string;
  actorName: string;
  /** The comment text for a mention, empty for an invite. */
  excerpt: string;
  read: boolean;
  createdAt: string;
}

/** Boards stay in the trash this many days, then are deleted for good. */
export const TRASH_DAYS = 30;

/** Whole days left before a trashed board is purged (0 means it goes at the next purge). */
export function daysUntilPurge(deletedAt: string, now = Date.now()): number {
  const left = Date.parse(deletedAt) + TRASH_DAYS * 86_400_000 - now;
  return Math.max(0, Math.ceil(left / 86_400_000));
}

export interface DataLayer {
  upsertUserByEmail(email: string, name: string): Promise<User>;
  getUser(id: string): Promise<User | null>;
  listBoards(userId: string, opts?: { q?: string; sort?: BoardSort; starredOnly?: boolean; trashed?: boolean }): Promise<BoardListItem[]>;
  createBoard(userId: string, name?: string): Promise<Board>;
  getBoard(boardId: string): Promise<Board | null>;
  getRole(boardId: string, userId: string): Promise<BoardRole | null>;
  renameBoard(userId: string, boardId: string, name: string): Promise<Board>;
  setStarred(userId: string, boardId: string, starred: boolean): Promise<void>;
  markOpened(userId: string, boardId: string): Promise<void>;
  trashBoard(userId: string, boardId: string): Promise<void>;
  restoreBoard(userId: string, boardId: string): Promise<void>;
  touchBoard(boardId: string): Promise<void>;
  /** Copy a board the user can edit: content (images keep working), name and description. The copy is private and theirs. */
  duplicateBoard(userId: string, boardId: string, name: string): Promise<Board>;
  /**
   * System job, no user: delete boards that have been in the trash longer than TRASH_DAYS.
   * Returns how many went and the stored files nothing references any more, for the caller to delete.
   */
  purgeTrash(now?: Date): Promise<{ boards: number; orphanedFiles: string[] }>;
  // Sharing: only owners and co-owners change access; anyone on the board sees the people list.
  listPeople(userId: string, boardId: string): Promise<Person[]>;
  shareBoard(userId: string, boardId: string, email: string, role: ShareRole): Promise<"added" | "invited">;
  setMemberRole(userId: string, boardId: string, memberId: string, role: ShareRole | null): Promise<void>;
  cancelInvite(userId: string, boardId: string, email: string): Promise<void>;
  setLinkAccess(userId: string, boardId: string, access: LinkAccess): Promise<void>;
  /** Owners and co-owners turn guest viewing (no sign-in, read-only) on or off. */
  setGuestView(userId: string, boardId: string, on: boolean): Promise<void>;
  /** The board link's secret, for anyone on the board (it goes into the link they copy). */
  getLinkSecret(userId: string, boardId: string): Promise<string>;
  /** Owners and co-owners make a new secret: every link given out before stops working. */
  resetLinkSecret(userId: string, boardId: string): Promise<string>;
  /**
   * A signed-in person opening a board shared by link joins it with the link's role. The link's secret is
   * required: a board id alone is never enough. maxRole caps an edit link (the plan's editor limit).
   */
  joinViaLink(userId: string, boardId: string, opts: { secret: string; maxRole?: "commenter" | "viewer" }): Promise<BoardRole | null>;
  /**
   * Someone who is not signed in, holding the link: the board's id and name when guest viewing is on and the
   * secret matches, otherwise null. Guests are read-only; there is nothing else they can call.
   */
  guestBoard(boardId: string, secret: string): Promise<{ id: string; name: string } | null>;
  /** An image for a guest: only on the board whose link secret they hold, and only while guest viewing is on. */
  getGuestAsset(assetId: string, secret: string): Promise<Asset | null>;
  // Comments (S09): anyone on the board reads them; commenters and up write. Mentions notify people on the board.
  listThreads(userId: string, boardId: string): Promise<CommentThread[]>;
  createThread(userId: string, boardId: string, at: { x: number; y: number; itemId?: string | null }, body: string, mentions?: string[]): Promise<CommentThread>;
  replyToThread(userId: string, threadId: string, body: string, mentions?: string[]): Promise<Comment>;
  setThreadResolved(userId: string, threadId: string, resolved: boolean): Promise<void>;
  /** How many unread mentions the user has, for the dashboard. */
  unreadMentions(userId: string): Promise<number>;
  // Notifications: each person sees and changes only their own. Boards they lost access to drop out.
  listNotifications(userId: string, limit?: number): Promise<AppNotification[]>;
  unreadNotifications(userId: string): Promise<number>;
  /** Mark the given notifications read, or all of them when ids is omitted. Ids that are not the user's are ignored. */
  markNotificationsRead(userId: string, ids?: string[]): Promise<void>;
  // Images: editors upload; anyone who can see the board can fetch them.
  createAsset(userId: string, asset: Omit<Asset, "id">): Promise<Asset>;
  getAsset(userId: string, assetId: string): Promise<Asset | null>;
  // Billing. getSubscription reads the person's own row. The rest are server-side only (service connection):
  // callers check access first, and nothing here takes plan or status from the browser.
  getSubscription(userId: string): Promise<Subscription | null>;
  boardUsage(boardId: string): Promise<BoardUsage | null>;
  setStripeCustomer(userId: string, customerId: string): Promise<void>;
  /** Runs apply once per Stripe event id, atomically with recording the id. Returns false for an event seen before. */
  applyStripeEvent(event: { id: string; type: string }, apply: (w: BillingWriter) => Promise<void>): Promise<boolean>;
}

/** Link secrets are 32 to 64 lower-case hex characters; anything else is rejected before any lookup. */
export const LINK_SECRET = /^[0-9a-f]{32,64}$/;

export const canEditBoard = (r: BoardRole | null) => r === "owner" || r === "coowner" || r === "editor";

export const canComment = (r: BoardRole | null) => r === "owner" || r === "coowner" || r === "editor" || r === "commenter";

export const SHARE_ROLES: ShareRole[] = ["editor", "commenter", "viewer"];
export const linkRole = (a: LinkAccess): ShareRole | null => (a === "edit" ? "editor" : a === "comment" ? "commenter" : a === "view" ? "viewer" : null);

export class AccessError extends Error {
  constructor(message = "You do not have access to this board") {
    super(message);
  }
}
