// Development data layer: one JSON file under .data/. Same signatures as the Supabase layer.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cloneBoardState } from "../board/clone";
import { AccessError, LINK_SECRET, LOGIN_LINK_MINUTES, LOGIN_LINKS_PER_HOUR, SHARE_ROLES, TRASH_DAYS, canComment, canEditBoard, linkRole, type AppNotification, type Board, type BoardListItem, type Asset, type BoardRole, type Comment, type CommentThread, type DataLayer, type Person, type ShareRole, type Subscription, type BillingWriter, type BoardUsage, type User } from "./types";

interface Db {
  users: User[];
  teams: { id: string; name: string; createdBy: string }[];
  teamMembers: { teamId: string; userId: string; role: "owner" | "admin" | "member" }[];
  boards: Board[];
  boardMembers: { boardId: string; userId: string; role: BoardRole; starred: boolean; lastOpenedAt: string | null }[];
  invites?: { boardId: string; email: string; role: ShareRole; invitedBy: string; acceptedAt: string | null }[];
  threads?: { id: string; boardId: string; itemId: string | null; x: number; y: number; resolvedAt: string | null; createdBy: string; createdAt: string }[];
  comments?: { id: string; threadId: string; authorId: string; body: string; createdAt: string }[];
  assets?: Asset[];
  notifications?: { id: string; userId: string; kind: "mention" | "invite"; boardId: string; commentId: string | null; actorId: string; readAt: string | null; createdAt: string }[];
  subscriptions?: (Subscription & { lastEventAt: string | null })[];
  stripeEvents?: { id: string; type: string; receivedAt: string }[];
  loginLinks?: { tokenHash: string; email: string; next: string; createdAt: string; expiresAt: string; usedAt: string | null }[];
  /** Each board's link secret (boards.link_token in Postgres), kept apart so board objects never carry it. */
  linkSecrets?: Record<string, string>;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "db.json");
const docFile = (boardId: string) => path.join(DATA_DIR, "docs", `${boardId}.bin`);
const empty = (): Db => ({ users: [], teams: [], teamMembers: [], boards: [], boardMembers: [] });

// Serialise every read-modify-write so concurrent requests cannot lose updates.
let queue: Promise<unknown> = Promise.resolve();
function tx<T>(fn: (db: Db) => T | Promise<T>, write = true): Promise<T> {
  const run = async () => {
    let db: Db;
    try {
      db = JSON.parse(await fs.readFile(FILE, "utf8"));
    } catch {
      db = empty();
    }
    const result = await fn(db);
    if (write) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db, null, 2));
      await fs.rename(tmp, FILE);
    }
    return result;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

// Board content is saved by the realtime server; its file time is the board's "last modified".
async function docModifiedTimes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dir = path.join(DATA_DIR, "docs");
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return out;
  }
  await Promise.all(
    names
      .filter((n) => n.endsWith(".bin"))
      .map(async (n) => {
        const st = await fs.stat(path.join(dir, n));
        out.set(n.slice(0, -4), st.mtime.toISOString());
      }),
  );
  return out;
}
const latest = (a: string, b?: string) => (b && b > a ? b : a);

const now = () => new Date().toISOString();
const newSecret = () => randomBytes(16).toString("hex");

function secretOf(db: Db, boardId: string): string {
  db.linkSecrets ??= {};
  return (db.linkSecrets[boardId] ??= newSecret());
}

/** True when the given link secret is the board's own; compared in constant time. */
function secretMatches(db: Db, boardId: string, secret: string): boolean {
  const own = db.linkSecrets?.[boardId];
  if (!own || typeof secret !== "string" || !LINK_SECRET.test(secret) || own.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(own), Buffer.from(secret));
}

/** Boards saved before guest viewing existed have no guestView field. */
const withDefaults = (b: Board): Board => ({ ...b, guestView: b.guestView ?? false });
const canManage = (r: BoardRole | null) => r === "owner" || r === "coowner";

function requireManager(db: Db, boardId: string, userId: string): Board {
  const b = db.boards.find((x) => x.id === boardId && !x.deletedAt);
  if (!b || !canManage(roleOf(db, boardId, userId))) throw new AccessError();
  return b;
}

function checkRole(role: ShareRole | null) {
  if (role !== null && !SHARE_ROLES.includes(role)) throw new Error("Unknown role");
}

const ROLE_ORDER: BoardRole[] = ["owner", "coowner", "editor", "commenter", "viewer"];

function cleanBody(body: string) {
  const clean = body.trim();
  if (!clean || clean.length > 5000) throw new Error("Comment must be 1 to 5000 characters");
  return clean;
}

function addComment(db: Db, boardId: string, threadId: string, userId: string, body: string, mentions: string[]): Comment {
  const c = { id: randomUUID(), threadId, authorId: userId, body: cleanBody(body), createdAt: now() };
  (db.comments ??= []).push(c);
  for (const u of new Set(mentions)) {
    if (u === userId || !roleOf(db, boardId, u)) continue;
    notify(db, u, "mention", boardId, userId, c.id);
  }
  return toComment(db, c);
}

function notify(db: Db, to: string, kind: "mention" | "invite", boardId: string, actorId: string, commentId: string | null) {
  if (to === actorId) return;
  (db.notifications ??= []).push({ id: randomUUID(), userId: to, kind, boardId, commentId, actorId, readAt: null, createdAt: now() });
}

/** The user's notifications on boards they can still open, newest first. */
function visibleNotifications(db: Db, userId: string) {
  return (db.notifications ?? []).filter((n) => n.userId === userId && liveRole(db, n.boardId, userId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const toComment = (db: Db, c: NonNullable<Db["comments"]>[number]): Comment => ({
  id: c.id,
  authorId: c.authorId,
  authorName: db.users.find((u) => u.id === c.authorId)?.name ?? "",
  body: c.body,
  createdAt: c.createdAt,
});

function liveRole(db: Db, boardId: string, userId: string) {
  const b = db.boards.find((x) => x.id === boardId);
  return b && !b.deletedAt ? roleOf(db, boardId, userId) : null;
}

const EDIT_ROLES: BoardRole[] = ["coowner", "editor"];

function subscriptionOf(db: Db, userId: string): Subscription | null {
  const row = (db.subscriptions ?? []).find((x) => x.userId === userId);
  if (!row) return null;
  const { lastEventAt: _, ...sub } = row;
  return { ...sub };
}

function subscriptionRow(db: Db, userId: string) {
  db.subscriptions ??= [];
  let row = db.subscriptions.find((x) => x.userId === userId);
  if (!row) {
    row = { userId, plan: "free", status: "none", stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, lastEventAt: null };
    db.subscriptions.push(row);
  }
  return row;
}

function roleOf(db: Db, boardId: string, userId: string): BoardRole | null {
  return db.boardMembers.find((m) => m.boardId === boardId && m.userId === userId)?.role ?? null;
}

export const localData: DataLayer = {
  upsertUserByEmail: (email, name) =>
    tx((db) => {
      const key = email.trim().toLowerCase();
      let user = db.users.find((u) => u.email === key);
      if (!user) {
        user = { id: randomUUID(), email: key, name: name.trim() || key.split("@")[0] };
        db.users.push(user);
        const teamId = randomUUID();
        db.teams.push({ id: teamId, name: `${user.name}'s team`, createdBy: user.id });
        db.teamMembers.push({ teamId, userId: user.id, role: "owner" });
        // Invites waiting for this address become memberships.
        for (const inv of db.invites ?? []) {
          if (inv.email !== key || inv.acceptedAt) continue;
          db.boardMembers.push({ boardId: inv.boardId, userId: user.id, role: inv.role, starred: false, lastOpenedAt: null });
          inv.acceptedAt = now();
          notify(db, user.id, "invite", inv.boardId, inv.invitedBy, null);
        }
      } else if (name.trim()) {
        user.name = name.trim();
      }
      return user;
    }),

  createLoginLink: (email, tokenHash, next) =>
    tx((db) => {
      const t = Date.now();
      db.loginLinks = (db.loginLinks ?? []).filter((l) => Date.parse(l.createdAt) > t - 86_400_000);
      const recent = db.loginLinks.filter((l) => l.email === email && Date.parse(l.createdAt) > t - 3_600_000).length;
      if (recent >= LOGIN_LINKS_PER_HOUR) return "too_many" as const;
      db.loginLinks.push({ tokenHash, email, next, createdAt: new Date(t).toISOString(), expiresAt: new Date(t + LOGIN_LINK_MINUTES * 60_000).toISOString(), usedAt: null });
      return "ok" as const;
    }),

  useLoginLink: (tokenHash) =>
    tx((db) => {
      const link = db.loginLinks?.find((l) => l.tokenHash === tokenHash);
      if (!link || link.usedAt || Date.parse(link.expiresAt) <= Date.now()) return null;
      link.usedAt = now();
      return { email: link.email, next: link.next };
    }),

  getUser: (id) => tx((db) => db.users.find((u) => u.id === id) ?? null, false),

  listBoards: async (userId, opts = {}) => {
    const docTimes = await docModifiedTimes();
    return tx((db) => {
      const q = opts.q?.trim().toLowerCase();
      const rows: BoardListItem[] = [];
      for (const m of db.boardMembers) {
        if (m.userId !== userId) continue;
        const b = db.boards.find((x) => x.id === m.boardId);
        if (!b) continue;
        if (Boolean(opts.trashed) !== Boolean(b.deletedAt)) continue;
        if (opts.starredOnly && !m.starred) continue;
        if (q && !b.name.toLowerCase().includes(q)) continue;
        rows.push({ ...withDefaults(b), updatedAt: latest(b.updatedAt, docTimes.get(b.id)), role: m.role, starred: m.starred, lastOpenedAt: m.lastOpenedAt });
      }
      const sort = opts.sort ?? "opened";
      rows.sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "modified"
            ? b.updatedAt.localeCompare(a.updatedAt)
            : (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt),
      );
      return rows;
    }, false);
  },

  createBoard: (userId, name) =>
    tx((db) => {
      const team = db.teamMembers.find((t) => t.userId === userId);
      if (!team) throw new AccessError("No team for this user");
      const ts = now();
      const board: Board = {
        id: randomUUID(),
        teamId: team.teamId,
        ownerId: userId,
        name: (name ?? "").trim().slice(0, 60) || "Untitled",
        description: "",
        linkAccess: "private",
        guestView: false,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      db.boards.push(board);
      db.boardMembers.push({ boardId: board.id, userId, role: "owner", starred: false, lastOpenedAt: ts });
      secretOf(db, board.id);
      return board;
    }),

  getBoard: (boardId) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId);
      return b ? withDefaults(b) : null;
    }, false),

  getRole: (boardId, userId) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId);
      if (!b || b.deletedAt) return null;
      return roleOf(db, boardId, userId);
    }, false),

  renameBoard: (userId, boardId, name) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId);
      if (!b || !canManage(roleOf(db, boardId, userId))) throw new AccessError();
      const clean = name.trim().slice(0, 60);
      if (!clean) throw new Error("Board name cannot be empty");
      b.name = clean;
      b.updatedAt = now();
      return withDefaults(b);
    }),

  setStarred: (userId, boardId, starred) =>
    tx((db) => {
      const m = db.boardMembers.find((x) => x.boardId === boardId && x.userId === userId);
      if (!m) throw new AccessError();
      m.starred = starred;
    }),

  markOpened: (userId, boardId) =>
    tx((db) => {
      const m = db.boardMembers.find((x) => x.boardId === boardId && x.userId === userId);
      if (m) m.lastOpenedAt = now();
    }),

  trashBoard: (userId, boardId) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId);
      if (!b || roleOf(db, boardId, userId) !== "owner") throw new AccessError();
      b.deletedAt = now();
    }),

  restoreBoard: (userId, boardId) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId);
      if (!b || roleOf(db, boardId, userId) !== "owner") throw new AccessError();
      b.deletedAt = null;
    }),

  touchBoard: (boardId) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId);
      if (b) b.updatedAt = now();
    }),

  duplicateBoard: async (userId, boardId, name) => {
    const { board, assets } = await tx((db) => {
      const src = db.boards.find((x) => x.id === boardId);
      if (!src || !canEditBoard(liveRole(db, boardId, userId))) throw new AccessError();
      const team = db.teamMembers.find((t) => t.userId === userId);
      if (!team) throw new AccessError("No team for this user");
      const ts = now();
      const board: Board = {
        id: randomUUID(),
        teamId: team.teamId,
        ownerId: userId,
        name: name.trim().slice(0, 60) || src.name,
        description: src.description,
        linkAccess: "private",
        guestView: false,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      db.boards.push(board);
      db.boardMembers.push({ boardId: board.id, userId, role: "owner", starred: false, lastOpenedAt: ts });
      // The copy gets its own asset rows over the same stored files, so its images do not depend on the original.
      const assets = new Map<string, string>();
      for (const a of (db.assets ?? []).filter((x) => x.boardId === boardId)) {
        const id = randomUUID();
        assets.set(a.id, id);
        db.assets!.push({ ...a, id, boardId: board.id });
      }
      return { board, assets };
    });
    let state: Uint8Array | null = null;
    try {
      state = new Uint8Array(await fs.readFile(docFile(boardId)));
    } catch {
      // never opened: nothing to copy
    }
    await fs.mkdir(path.dirname(docFile(board.id)), { recursive: true });
    await fs.writeFile(docFile(board.id), cloneBoardState(state, assets));
    return board;
  },

  purgeTrash: async (at = new Date()) => {
    const cutoff = new Date(at.getTime() - TRASH_DAYS * 86_400_000).toISOString();
    const { gone, orphanedFiles } = await tx((db) => {
      const gone = new Set(db.boards.filter((b) => b.deletedAt && b.deletedAt < cutoff).map((b) => b.id));
      if (!gone.size) return { gone, orphanedFiles: [] as string[] };
      const threads = new Set((db.threads ?? []).filter((t) => gone.has(t.boardId)).map((t) => t.id));
      const paths = new Set((db.assets ?? []).filter((a) => gone.has(a.boardId)).map((a) => a.storagePath));
      db.boards = db.boards.filter((b) => !gone.has(b.id));
      db.boardMembers = db.boardMembers.filter((m) => !gone.has(m.boardId));
      db.invites = (db.invites ?? []).filter((i) => !gone.has(i.boardId));
      db.threads = (db.threads ?? []).filter((t) => !threads.has(t.id));
      db.comments = (db.comments ?? []).filter((c) => !threads.has(c.threadId));
      db.notifications = (db.notifications ?? []).filter((n) => !gone.has(n.boardId));
      db.assets = (db.assets ?? []).filter((a) => !gone.has(a.boardId));
      // A duplicate may share a stored file with the purged board: keep files still in use.
      for (const a of db.assets) paths.delete(a.storagePath);
      return { gone, orphanedFiles: [...paths] };
    });
    await Promise.all([...gone].map((id) => fs.rm(docFile(id), { force: true })));
    return { boards: gone.size, orphanedFiles };
  },

  listPeople: (userId, boardId) =>
    tx((db) => {
      if (!roleOf(db, boardId, userId)) throw new AccessError();
      const people: Person[] = db.boardMembers
        .filter((m) => m.boardId === boardId)
        .map((m) => {
          const u = db.users.find((x) => x.id === m.userId)!;
          return { userId: u.id, name: u.name, email: u.email, role: m.role, pending: false };
        })
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
      for (const i of db.invites ?? []) if (i.boardId === boardId && !i.acceptedAt) people.push({ userId: null, name: "", email: i.email, role: i.role, pending: true });
      return people;
    }, false),

  shareBoard: (userId, boardId, email, role) =>
    tx((db) => {
      requireManager(db, boardId, userId);
      checkRole(role);
      const key = email.trim().toLowerCase();
      const user = db.users.find((u) => u.email === key);
      if (user) {
        const m = db.boardMembers.find((x) => x.boardId === boardId && x.userId === user.id);
        if (!m) {
          db.boardMembers.push({ boardId, userId: user.id, role, starred: false, lastOpenedAt: null });
          notify(db, user.id, "invite", boardId, userId, null);
        } else if (!canManage(m.role)) m.role = role;
        return "added" as const;
      }
      db.invites ??= [];
      const inv = db.invites.find((i) => i.boardId === boardId && i.email === key);
      if (inv) Object.assign(inv, { role, acceptedAt: null });
      else db.invites.push({ boardId, email: key, role, invitedBy: userId, acceptedAt: null });
      return "invited" as const;
    }),

  setMemberRole: (userId, boardId, memberId, role) =>
    tx((db) => {
      requireManager(db, boardId, userId);
      checkRole(role);
      const i = db.boardMembers.findIndex((x) => x.boardId === boardId && x.userId === memberId);
      if (i < 0) return;
      if (db.boardMembers[i].role === "owner") throw new AccessError("The owner cannot be changed");
      if (role === null) db.boardMembers.splice(i, 1);
      else db.boardMembers[i].role = role;
    }),

  cancelInvite: (userId, boardId, email) =>
    tx((db) => {
      requireManager(db, boardId, userId);
      const key = email.trim().toLowerCase();
      db.invites = (db.invites ?? []).filter((i) => !(i.boardId === boardId && i.email === key && !i.acceptedAt));
    }),

  setLinkAccess: (userId, boardId, access) =>
    tx((db) => {
      const b = requireManager(db, boardId, userId);
      b.linkAccess = access;
      b.updatedAt = now();
    }),

  setGuestView: (userId, boardId, on) =>
    tx((db) => {
      const b = requireManager(db, boardId, userId);
      b.guestView = on;
      b.updatedAt = now();
    }),

  getLinkSecret: (userId, boardId) =>
    tx((db) => {
      if (!liveRole(db, boardId, userId)) throw new AccessError();
      return secretOf(db, boardId);
    }),

  resetLinkSecret: (userId, boardId) =>
    tx((db) => {
      requireManager(db, boardId, userId);
      db.linkSecrets ??= {};
      return (db.linkSecrets[boardId] = newSecret());
    }),

  joinViaLink: (userId, boardId, opts) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId && !x.deletedAt);
      if (!b) return null;
      const current = roleOf(db, boardId, userId);
      if (current) return current;
      if (!secretMatches(db, boardId, opts.secret)) return null;
      let via = linkRole(b.linkAccess);
      if (!via) return null;
      if (via === "editor" && opts.maxRole) via = opts.maxRole;
      db.boardMembers.push({ boardId, userId, role: via, starred: false, lastOpenedAt: null });
      return via;
    }),

  guestBoard: (boardId, secret) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId && !x.deletedAt);
      if (!b || !b.guestView || b.linkAccess === "private" || !secretMatches(db, boardId, secret)) return null;
      return { id: b.id, name: b.name, linkAccess: b.linkAccess };
    }, false),

  getGuestAsset: (assetId, secret) =>
    tx((db) => {
      const a = (db.assets ?? []).find((x) => x.id === assetId);
      if (!a) return null;
      const b = db.boards.find((x) => x.id === a.boardId && !x.deletedAt);
      if (!b || !b.guestView || b.linkAccess === "private" || !secretMatches(db, b.id, secret)) return null;
      return a;
    }, false),

  listThreads: (userId, boardId) =>
    tx((db) => {
      if (!liveRole(db, boardId, userId)) throw new AccessError();
      return (db.threads ?? [])
        .filter((t) => t.boardId === boardId)
        .map(
          (t): CommentThread => ({
            id: t.id,
            itemId: t.itemId,
            x: t.x,
            y: t.y,
            resolved: Boolean(t.resolvedAt),
            createdBy: t.createdBy,
            createdAt: t.createdAt,
            comments: (db.comments ?? []).filter((c) => c.threadId === t.id).map((c) => toComment(db, c)),
          }),
        );
    }, false),

  createThread: (userId, boardId, at, body, mentions = []) =>
    tx((db) => {
      if (!canComment(liveRole(db, boardId, userId))) throw new AccessError();
      const t = { id: randomUUID(), boardId, itemId: at.itemId ?? null, x: at.x, y: at.y, resolvedAt: null, createdBy: userId, createdAt: now() };
      cleanBody(body);
      (db.threads ??= []).push(t);
      const c = addComment(db, boardId, t.id, userId, body, mentions);
      return { id: t.id, itemId: t.itemId, x: t.x, y: t.y, resolved: false, createdBy: userId, createdAt: t.createdAt, comments: [c] };
    }),

  replyToThread: (userId, threadId, body, mentions = []) =>
    tx((db) => {
      const t = (db.threads ?? []).find((x) => x.id === threadId);
      if (!t || !canComment(liveRole(db, t.boardId, userId))) throw new AccessError();
      return addComment(db, t.boardId, t.id, userId, body, mentions);
    }),

  setThreadResolved: (userId, threadId, resolved) =>
    tx((db) => {
      const t = (db.threads ?? []).find((x) => x.id === threadId);
      if (!t || !canComment(liveRole(db, t.boardId, userId))) throw new AccessError();
      t.resolvedAt = resolved ? now() : null;
    }),

  unreadMentions: (userId) => tx((db) => (db.notifications ?? []).filter((n) => n.userId === userId && n.kind === "mention" && !n.readAt).length, false),

  listNotifications: (userId, limit = 50) =>
    tx(
      (db) =>
        visibleNotifications(db, userId)
          .slice(0, limit)
          .map(
            (n): AppNotification => ({
              id: n.id,
              kind: n.kind,
              boardId: n.boardId,
              boardName: db.boards.find((b) => b.id === n.boardId)?.name ?? "",
              actorName: db.users.find((u) => u.id === n.actorId)?.name ?? "",
              excerpt: (n.commentId && (db.comments ?? []).find((c) => c.id === n.commentId)?.body) || "",
              read: Boolean(n.readAt),
              createdAt: n.createdAt,
            }),
          ),
      false,
    ),

  unreadNotifications: (userId) => tx((db) => visibleNotifications(db, userId).filter((n) => !n.readAt).length, false),

  markNotificationsRead: (userId, ids) =>
    tx((db) => {
      const only = ids && new Set(ids);
      for (const n of db.notifications ?? []) if (n.userId === userId && !n.readAt && (!only || only.has(n.id))) n.readAt = now();
    }),

  createAsset: (userId, asset) =>
    tx((db) => {
      if (!canEditBoard(liveRole(db, asset.boardId, userId))) throw new AccessError();
      const a: Asset = { ...asset, id: randomUUID() };
      (db.assets ??= []).push(a);
      return a;
    }),

  getAsset: (userId, assetId) =>
    tx((db) => {
      const a = (db.assets ?? []).find((x) => x.id === assetId);
      return a && liveRole(db, a.boardId, userId) ? a : null;
    }, false),

  getSubscription: (userId) => tx((db) => subscriptionOf(db, userId), false),

  boardUsage: (boardId) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId);
      if (!b) return null;
      const editors: BoardUsage["editors"] = db.boardMembers
        .filter((m) => m.boardId === boardId && EDIT_ROLES.includes(m.role))
        .map((m) => ({ userId: m.userId, email: db.users.find((u) => u.id === m.userId)?.email ?? "" }));
      for (const i of db.invites ?? []) if (i.boardId === boardId && !i.acceptedAt && i.role === "editor") editors.push({ userId: null, email: i.email });
      const owned = new Set(db.boards.filter((x) => x.ownerId === b.ownerId).map((x) => x.id));
      const storageBytes = (db.assets ?? []).filter((a) => owned.has(a.boardId)).reduce((n, a) => n + a.bytes, 0);
      return { ownerId: b.ownerId, ownerSubscription: subscriptionOf(db, b.ownerId), editors, storageBytes };
    }, false),

  setStripeCustomer: (userId, customerId) =>
    tx((db) => {
      subscriptionRow(db, userId).stripeCustomerId = customerId;
    }),

  applyStripeEvent: (event, apply) =>
    tx(async (db) => {
      db.stripeEvents ??= [];
      if (db.stripeEvents.some((e) => e.id === event.id)) return false;
      const writer: BillingWriter = {
        userIdForCustomer: async (customerId) => (db.subscriptions ?? []).find((x) => x.stripeCustomerId === customerId)?.userId ?? null,
        getSubscription: async (userId) => subscriptionOf(db, userId),
        saveSubscription: async (userId, { eventAt, ...patch }) => {
          if (!db.users.some((u) => u.id === userId)) throw new Error("Unknown user");
          const row = subscriptionRow(db, userId);
          if (row.lastEventAt && row.lastEventAt > eventAt) return "stale";
          Object.assign(row, patch, { lastEventAt: eventAt });
          return "saved";
        },
      };
      // A throw here leaves the file untouched, so Stripe's retry runs the handler again.
      await apply(writer);
      db.stripeEvents.push({ id: event.id, type: event.type, receivedAt: now() });
      return true;
    }),
};
