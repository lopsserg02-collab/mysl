// Development data layer: one JSON file under .data/. Same signatures as the Supabase layer.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AccessError, SHARE_ROLES, canComment, linkRole, type Board, type BoardListItem, type BoardRole, type Comment, type CommentThread, type DataLayer, type Person, type ShareRole, type User } from "./types";

interface Db {
  users: User[];
  teams: { id: string; name: string; createdBy: string }[];
  teamMembers: { teamId: string; userId: string; role: "owner" | "admin" | "member" }[];
  boards: Board[];
  boardMembers: { boardId: string; userId: string; role: BoardRole; starred: boolean; lastOpenedAt: string | null }[];
  invites?: { boardId: string; email: string; role: ShareRole; invitedBy: string; acceptedAt: string | null }[];
  threads?: { id: string; boardId: string; itemId: string | null; x: number; y: number; resolvedAt: string | null; createdBy: string; createdAt: string }[];
  comments?: { id: string; threadId: string; authorId: string; body: string; createdAt: string }[];
  notifications?: { id: string; userId: string; kind: "mention"; boardId: string; commentId: string; actorId: string; readAt: string | null; createdAt: string }[];
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "db.json");
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
    (db.notifications ??= []).push({ id: randomUUID(), userId: u, kind: "mention", boardId, commentId: c.id, actorId: userId, readAt: null, createdAt: c.createdAt });
  }
  return toComment(db, c);
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
        }
      } else if (name.trim()) {
        user.name = name.trim();
      }
      return user;
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
        rows.push({ ...b, updatedAt: latest(b.updatedAt, docTimes.get(b.id)), role: m.role, starred: m.starred, lastOpenedAt: m.lastOpenedAt });
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
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      db.boards.push(board);
      db.boardMembers.push({ boardId: board.id, userId, role: "owner", starred: false, lastOpenedAt: ts });
      return board;
    }),

  getBoard: (boardId) => tx((db) => db.boards.find((b) => b.id === boardId) ?? null, false),

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
      return b;
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
        if (!m) db.boardMembers.push({ boardId, userId: user.id, role, starred: false, lastOpenedAt: null });
        else if (!canManage(m.role)) m.role = role;
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

  joinViaLink: (userId, boardId) =>
    tx((db) => {
      const b = db.boards.find((x) => x.id === boardId && !x.deletedAt);
      if (!b) return null;
      const current = roleOf(db, boardId, userId);
      if (current) return current;
      const via = linkRole(b.linkAccess);
      if (!via) return null;
      db.boardMembers.push({ boardId, userId, role: via, starred: false, lastOpenedAt: null });
      return via;
    }),

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

  unreadMentions: (userId) => tx((db) => (db.notifications ?? []).filter((n) => n.userId === userId && !n.readAt).length, false),
};
