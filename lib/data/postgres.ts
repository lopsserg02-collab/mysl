// Postgres data layer (Supabase or any Postgres with db/dev/supabase-stub.sql).
// Every user query runs as the `authenticated` role with the user's id in the JWT claims,
// so the row level security policies in db/migrations decide what each person can see and change.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { cloneBoardState } from "../board/clone";
import { AccessError, LINK_SECRET, TRASH_DAYS, canEditBoard, type AppNotification, type Board, type BoardListItem, type BoardRole, type LinkAccess, type DataLayer, type Asset, type Comment, type CommentThread, type Person, type User, type BillingWriter, type Subscription } from "./types";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

let client: Sql | null = null;
function sql(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = postgres(url, { max: 5, onnotice: () => {}, prepare: false }); // prepare:false works through Supabase's pooler
  }
  return client;
}

async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return (await sql().begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      await tx.unsafe("set local role authenticated");
      return fn(tx);
    })) as T;
  } catch (e) {
    // insufficient_privilege, raised by the sharing functions and by row level security
    if ((e as { code?: string }).code === "42501") throw new AccessError();
    throw e;
  }
}

// Someone who is not signed in: Supabase's anon role, which reaches boards only through the guest_* functions.
function asGuest<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "anon" })}, true)`;
    await tx.unsafe("set local role anon");
    return fn(tx);
  }) as Promise<T>;
}

interface BoardRow {
  id: string;
  team_id: string;
  owner_id: string;
  name: string;
  description: string;
  link_access: Board["linkAccess"];
  guest_view: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  content_updated_at: Date | null;
}

const toBoard = (r: BoardRow): Board => ({
  id: r.id,
  teamId: r.team_id,
  ownerId: r.owner_id,
  name: r.name,
  description: r.description,
  linkAccess: r.link_access,
  guestView: r.guest_view ?? false,
  createdAt: r.created_at.toISOString(),
  updatedAt: (r.content_updated_at && r.content_updated_at > r.updated_at ? r.content_updated_at : r.updated_at).toISOString(),
  deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
});

const UUID = /^[0-9a-f-]{36}$/i;

export const postgresData: DataLayer = {
  // Development sign-in only. With Supabase Auth, accounts are created by Supabase and the trigger makes the profile.
  async upsertUserByEmail(email, name) {
    if (process.env.NODE_ENV === "production" && process.env.DEV_SIGN_IN !== "1") throw new Error("Dev sign-in is disabled");
    const key = email.trim().toLowerCase();
    const db = sql();
    const [existing] = await db<{ id: string }[]>`select id from auth.users where email = ${key}`;
    const id = existing?.id ?? (await db<{ id: string }[]>`insert into auth.users (email, raw_user_meta_data) values (${key}, ${db.json({ name: name.trim() })}) returning id`)[0].id;
    if (existing && name.trim()) await asUser(id, (tx) => tx`update profiles set name = ${name.trim()}, updated_at = now() where id = ${id}`);
    return (await postgresData.getUser(id))!;
  },

  async getUser(id) {
    if (!UUID.test(id)) return null;
    const [row] = await asUser(id, (tx) => tx<User[]>`select id, name, email from profiles where id = ${id}`);
    return row ?? null;
  },

  listBoards(userId, opts = {}) {
    const q = opts.q?.trim() ? `%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const order = opts.sort === "name" ? "b.name asc" : opts.sort === "modified" ? "greatest(b.updated_at, coalesce(b.content_updated_at, b.updated_at)) desc" : "coalesce(m.last_opened_at, b.created_at) desc";
    return asUser(userId, async (tx) => {
      const rows = await tx<(BoardRow & { role: BoardRole; starred: boolean; last_opened_at: Date | null })[]>`
        select b.*, m.role, m.starred, m.last_opened_at
        from board_members m
        join boards b on b.id = m.board_id
        where m.user_id = ${userId}
          and ${opts.trashed ? tx`b.deleted_at is not null` : tx`b.deleted_at is null`}
          and ${opts.starredOnly ? tx`m.starred` : tx`true`}
          and ${q ? tx`b.name ilike ${q}` : tx`true`}
        order by ${tx.unsafe(order)}
        limit 500`;
      return rows.map((r): BoardListItem => ({ ...toBoard(r), role: r.role, starred: r.starred, lastOpenedAt: r.last_opened_at?.toISOString() ?? null }));
    });
  },

  createBoard(userId, name) {
    return asUser(userId, async (tx) => {
      const [team] = await tx<{ team_id: string }[]>`select team_id from team_members where user_id = ${userId} order by created_at limit 1`;
      if (!team) throw new AccessError("No team for this user");
      const clean = (name ?? "").trim().slice(0, 60) || "Untitled";
      // No RETURNING: the new row only becomes readable once the owner membership trigger has run.
      const id = randomUUID();
      await tx`insert into boards (id, team_id, owner_id, name) values (${id}, ${team.team_id}, ${userId}, ${clean})`;
      const [row] = await tx<BoardRow[]>`select * from boards where id = ${id}`;
      return toBoard(row);
    });
  },

  async getBoard(boardId) {
    if (!UUID.test(boardId)) return null;
    // Metadata only (name for the page title); access is checked separately with getRole. Never the link secret.
    const [row] = await sql()<BoardRow[]>`select id, team_id, owner_id, name, description, link_access, guest_view, created_at, updated_at, deleted_at, content_updated_at
      from boards where id = ${boardId}`;
    return row ? toBoard(row) : null;
  },

  async getRole(boardId, userId) {
    if (!UUID.test(boardId)) return null;
    // A board in the trash cannot be opened.
    const [row] = await asUser(userId, (tx) => tx<{ role: BoardRole | null }[]>`select board_role(id, ${userId}) as role from boards where id = ${boardId} and deleted_at is null`);
    return row?.role ?? null;
  },

  renameBoard(userId, boardId, name) {
    return asUser(userId, async (tx) => {
      const clean = name.trim().slice(0, 60);
      if (!clean) throw new Error("Board name cannot be empty");
      const [row] = await tx<BoardRow[]>`update boards set name = ${clean} where id = ${boardId} returning *`;
      if (!row) throw new AccessError();
      return toBoard(row);
    });
  },

  async setStarred(userId, boardId, starred) {
    const n = await asUser(userId, (tx) => tx`update board_members set starred = ${starred} where board_id = ${boardId} and user_id = ${userId}`);
    if (n.count === 0) throw new AccessError();
  },

  async markOpened(userId, boardId) {
    await asUser(userId, (tx) => tx`update board_members set last_opened_at = now() where board_id = ${boardId} and user_id = ${userId}`);
  },

  async trashBoard(userId, boardId) {
    const n = await asUser(userId, (tx) => tx`update boards set deleted_at = now() where id = ${boardId} and owner_id = ${userId} and deleted_at is null`);
    if (n.count === 0) throw new AccessError();
  },

  async restoreBoard(userId, boardId) {
    const n = await asUser(userId, async (tx) => {
      // A trashed board is invisible to board_role(), so the owner restores it through the owner check alone.
      return tx`update boards set deleted_at = null where id = ${boardId} and owner_id = ${userId} and deleted_at is not null`;
    });
    if (n.count === 0) throw new AccessError();
  },

  async touchBoard() {
    // Board content time lives in board_docs; nothing to do.
  },

  async duplicateBoard(userId, boardId, name) {
    if (!UUID.test(boardId)) throw new AccessError();
    return asUser(userId, async (tx) => {
      const [src] = await tx<(BoardRow & { role: BoardRole | null })[]>`select b.*, board_role(b.id, ${userId}) as role from boards b where id = ${boardId} and deleted_at is null`;
      if (!src || !canEditBoard(src.role)) throw new AccessError();
      const [team] = await tx<{ team_id: string }[]>`select team_id from team_members where user_id = ${userId} order by created_at limit 1`;
      if (!team) throw new AccessError("No team for this user");
      const id = randomUUID();
      const clean = name.trim().slice(0, 60) || src.name;
      // Row level security: a new board must be the caller's own, in their team. The trigger makes them owner.
      await tx`insert into boards (id, team_id, owner_id, name, description) values (${id}, ${team.team_id}, ${userId}, ${clean}, ${src.description})`;
      // The copy's images get their own asset rows over the same stored files (readable through the source, writable as the new owner).
      const assets = new Map<string, string>();
      const rows = await tx<{ id: string; uploaded_by: string | null; storage_path: string; mime: string; bytes: number; width: number | null; height: number | null }[]>`
        select id, uploaded_by, storage_path, mime, bytes, width, height from assets where board_id = ${boardId}`;
      for (const a of rows) {
        const next = randomUUID();
        assets.set(a.id, next);
        await tx`insert into assets (id, board_id, uploaded_by, storage_path, mime, bytes, width, height)
          values (${next}, ${id}, ${a.uploaded_by}, ${a.storage_path}, ${a.mime}, ${a.bytes}, ${a.width}, ${a.height})`;
      }
      const [doc] = await tx<{ s: Buffer | null }[]>`select board_doc_state(${boardId}) as s`;
      const state = cloneBoardState(doc?.s ? new Uint8Array(doc.s) : null, assets);
      await tx`select seed_board_doc(${id}, ${Buffer.from(state)})`;
      const [row] = await tx<BoardRow[]>`select * from boards where id = ${id}`;
      return toBoard(row);
    });
  },

  async purgeTrash(at = new Date()) {
    // A system job: runs as the connection's own role (the database owner), not as a user.
    const cutoff = new Date(at.getTime() - TRASH_DAYS * 86_400_000);
    return sql().begin(async (tx) => {
      const paths = await tx<{ storage_path: string }[]>`
        select distinct a.storage_path from assets a join boards b on b.id = a.board_id where b.deleted_at < ${cutoff}`;
      const gone = await tx`delete from boards where deleted_at < ${cutoff}`;
      const candidates = paths.map((r) => r.storage_path);
      const kept = candidates.length ? await tx<{ storage_path: string }[]>`select distinct storage_path from assets where storage_path in ${tx(candidates)}` : [];
      const inUse = new Set(kept.map((r) => r.storage_path));
      return { boards: gone.count, orphanedFiles: candidates.filter((p) => !inUse.has(p)) };
    }) as Promise<{ boards: number; orphanedFiles: string[] }>;
  },

  listPeople(userId, boardId) {
    return asUser(userId, async (tx) => {
      const rows = await tx<{ user_id: string | null; name: string; email: string; role: BoardRole; pending: boolean }[]>`select * from board_people(${boardId})`;
      return rows.map((r): Person => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, pending: r.pending }));
    });
  },

  async shareBoard(userId, boardId, email, role) {
    const [row] = await asUser(userId, (tx) => tx<{ r: "added" | "invited" }[]>`select share_board(${boardId}, ${email}, ${role}) as r`);
    return row.r;
  },

  async setMemberRole(userId, boardId, memberId, role) {
    await asUser(userId, (tx) => tx`select set_member_role(${boardId}, ${memberId}, ${role})`);
  },

  async cancelInvite(userId, boardId, email) {
    await asUser(userId, (tx) => tx`select cancel_invite(${boardId}, ${email})`);
  },

  async setLinkAccess(userId, boardId, access) {
    const n = await asUser(userId, (tx) => tx`update boards set link_access = ${access} where id = ${boardId} and deleted_at is null`);
    if (n.count === 0) throw new AccessError();
  },

  async setGuestView(userId, boardId, on) {
    // Row level security: only owners and co-owners update boards.
    const n = await asUser(userId, (tx) => tx`update boards set guest_view = ${on} where id = ${boardId} and deleted_at is null`);
    if (n.count === 0) throw new AccessError();
  },

  async getLinkSecret(userId, boardId) {
    if (!UUID.test(boardId)) throw new AccessError();
    // Row level security: anyone on the board reads its row.
    const [row] = await asUser(userId, (tx) => tx<{ link_token: string }[]>`select link_token from boards where id = ${boardId} and deleted_at is null`);
    if (!row) throw new AccessError();
    return row.link_token;
  },

  async resetLinkSecret(userId, boardId) {
    if (!UUID.test(boardId)) throw new AccessError();
    const next = randomBytes(16).toString("hex");
    const n = await asUser(userId, (tx) => tx`update boards set link_token = ${next} where id = ${boardId} and deleted_at is null`);
    if (n.count === 0) throw new AccessError();
    return next;
  },

  async joinViaLink(userId, boardId, opts) {
    if (!UUID.test(boardId)) return null;
    const cap = opts.maxRole ?? null;
    const secret = LINK_SECRET.test(opts.secret ?? "") ? opts.secret : "";
    const [row] = await asUser(userId, (tx) => tx<{ role: BoardRole | null }[]>`select join_board_via_link(${boardId}, ${secret}::text, ${cap}::text) as role`);
    return row?.role ?? null;
  },

  async guestBoard(boardId, secret) {
    if (!UUID.test(boardId) || typeof secret !== "string" || !LINK_SECRET.test(secret)) return null;
    const [row] = await asGuest((tx) => tx<{ id: string; name: string; link_access: LinkAccess }[]>`select * from guest_board(${boardId}, ${secret})`);
    return row ? { id: row.id, name: row.name, linkAccess: row.link_access } : null;
  },

  async getGuestAsset(assetId, secret) {
    if (!UUID.test(assetId) || typeof secret !== "string" || !LINK_SECRET.test(secret)) return null;
    const [r] = await asGuest((tx) => tx<{ id: string; board_id: string; storage_path: string; mime: Asset["mime"]; bytes: number; width: number | null; height: number | null }[]>`
      select * from guest_asset(${assetId}, ${secret})`);
    return r ? { id: r.id, boardId: r.board_id, storagePath: r.storage_path, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height } : null;
  },

  listThreads(userId, boardId) {
    if (!UUID.test(boardId)) return Promise.resolve([]);
    return asUser(userId, async (tx) => {
      const rows = await tx<CommentRow[]>`select * from board_comments(${boardId})`;
      const threads = new Map<string, CommentThread>();
      for (const r of rows) {
        let t = threads.get(r.thread_id);
        if (!t) {
          t = { id: r.thread_id, itemId: r.item_id, x: r.x, y: r.y, resolved: r.resolved, createdBy: r.thread_created_by, createdAt: r.thread_created_at.toISOString(), comments: [] };
          threads.set(t.id, t);
        }
        t.comments.push({ id: r.comment_id, authorId: r.author_id, authorName: r.author_name, body: r.body, createdAt: r.created_at.toISOString() });
      }
      return [...threads.values()];
    });
  },

  createThread(userId, boardId, at, body, mentions = []) {
    return asUser(userId, async (tx) => {
      const id = randomUUID();
      await tx`insert into comment_threads (id, board_id, item_id, x, y, created_by) values (${id}, ${boardId}, ${at.itemId ?? null}, ${at.x}, ${at.y}, ${userId})`;
      const comment = await insertComment(tx, userId, id, body, mentions);
      return { id, itemId: at.itemId ?? null, x: at.x, y: at.y, resolved: false, createdBy: userId, createdAt: comment.createdAt, comments: [comment] };
    });
  },

  replyToThread(userId, threadId, body, mentions = []) {
    if (!UUID.test(threadId)) return Promise.reject(new AccessError());
    return asUser(userId, (tx) => insertComment(tx, userId, threadId, body, mentions));
  },

  async setThreadResolved(userId, threadId, resolved) {
    if (!UUID.test(threadId)) throw new AccessError();
    const n = await asUser(userId, (tx) =>
      resolved
        ? tx`update comment_threads set resolved_at = now(), resolved_by = ${userId} where id = ${threadId}`
        : tx`update comment_threads set resolved_at = null, resolved_by = null where id = ${threadId}`,
    );
    if (n.count === 0) throw new AccessError();
  },

  async unreadMentions(userId) {
    const [row] = await asUser(userId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${userId} and kind = 'mention' and read_at is null`);
    return row.n;
  },

  listNotifications(userId, limit = 50) {
    return asUser(userId, async (tx) => {
      const rows = await tx<{ id: string; kind: AppNotification["kind"]; board_id: string; board_name: string; actor_name: string; excerpt: string; read: boolean; created_at: Date }[]>`
        select * from my_notifications(${limit})`;
      return rows.map((r): AppNotification => ({
        id: r.id,
        kind: r.kind,
        boardId: r.board_id,
        boardName: r.board_name,
        actorName: r.actor_name,
        excerpt: r.excerpt,
        read: r.read,
        createdAt: r.created_at.toISOString(),
      }));
    });
  },

  async unreadNotifications(userId) {
    const [row] = await asUser(userId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from my_notifications(200) where not read`);
    return row.n;
  },

  async markNotificationsRead(userId, ids) {
    const only = ids?.filter((i) => UUID.test(i));
    if (only && !only.length) return;
    // Row level security limits this to the caller's own rows whatever ids are passed.
    await asUser(userId, (tx) =>
      only
        ? tx`update notifications set read_at = now() where user_id = ${userId} and read_at is null and id = any(${only}::uuid[])`
        : tx`update notifications set read_at = now() where user_id = ${userId} and read_at is null`,
    );
  },

  async createAsset(userId, a) {
    const id = randomUUID();
    // Row level security: only editors of the board may insert.
    await asUser(userId, (tx) => tx`insert into assets (id, board_id, uploaded_by, storage_path, mime, bytes, width, height)
      values (${id}, ${a.boardId}, ${userId}, ${a.storagePath}, ${a.mime}, ${a.bytes}, ${a.width}, ${a.height})`);
    return { ...a, id };
  },

  async getAsset(userId, assetId) {
    if (!UUID.test(assetId)) return null;
    const [r] = await asUser(userId, (tx) => tx<{ id: string; board_id: string; storage_path: string; mime: Asset["mime"]; bytes: number; width: number | null; height: number | null }[]>`
      select a.* from assets a join boards b on b.id = a.board_id where a.id = ${assetId} and b.deleted_at is null`);
    return r ? { id: r.id, boardId: r.board_id, storagePath: r.storage_path, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height } : null;
  },

  async getSubscription(userId) {
    if (!UUID.test(userId)) return null;
    // Row level security: a person reads only their own row.
    const [r] = await asUser(userId, (tx) => tx<SubscriptionRow[]>`select * from subscriptions where user_id = ${userId}`);
    return r ? toSubscription(r) : null;
  },

  async boardUsage(boardId) {
    if (!UUID.test(boardId)) return null;
    // Service connection: the caller already checked access, and counts cross other people's rows.
    const db = sql();
    const [b] = await db<{ owner_id: string }[]>`select owner_id from boards where id = ${boardId}`;
    if (!b) return null;
    const [sub] = await db<SubscriptionRow[]>`select * from subscriptions where user_id = ${b.owner_id}`;
    const editors = await db<{ user_id: string | null; email: string }[]>`
      select m.user_id, lower(p.email) as email from board_members m join profiles p on p.id = m.user_id
       where m.board_id = ${boardId} and m.role in ('coowner', 'editor')
      union all
      select null, lower(i.email) from board_invites i where i.board_id = ${boardId} and i.accepted_at is null and i.role = 'editor'`;
    const [st] = await db<{ n: string }[]>`select coalesce(sum(a.bytes), 0)::text as n from assets a join boards x on x.id = a.board_id where x.owner_id = ${b.owner_id}`;
    return {
      ownerId: b.owner_id,
      ownerSubscription: sub ? toSubscription(sub) : null,
      editors: editors.map((e) => ({ userId: e.user_id, email: e.email })),
      storageBytes: Number(st.n),
    };
  },

  async setStripeCustomer(userId, customerId) {
    await sql()`insert into subscriptions (user_id, stripe_customer_id) values (${userId}, ${customerId})
      on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id, updated_at = now()`;
  },

  async applyStripeEvent(event, apply) {
    return (await sql().begin(async (tx) => {
      const seen = await tx`insert into stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing returning id`;
      if (seen.length === 0) return false;
      const writer: BillingWriter = {
        async userIdForCustomer(customerId) {
          const [r] = await tx<{ user_id: string }[]>`select user_id from subscriptions where stripe_customer_id = ${customerId}`;
          return r?.user_id ?? null;
        },
        async getSubscription(userId) {
          const [r] = await tx<SubscriptionRow[]>`select * from subscriptions where user_id = ${userId}`;
          return r ? toSubscription(r) : null;
        },
        async saveSubscription(userId, { eventAt, ...p }) {
          // Row lock, then skip changes older than the last one applied (Stripe does not order deliveries).
          await tx`insert into subscriptions (user_id) values (${userId}) on conflict (user_id) do nothing`;
          const [cur] = await tx<{ last_event_at: Date | null }[]>`select last_event_at from subscriptions where user_id = ${userId} for update`;
          if (cur.last_event_at && cur.last_event_at.toISOString() > eventAt) return "stale";
          const cols: Record<string, unknown> = { last_event_at: eventAt, updated_at: new Date().toISOString() };
          if (p.plan !== undefined) cols.plan = p.plan;
          if (p.status !== undefined) cols.status = p.status;
          if (p.stripeCustomerId !== undefined) cols.stripe_customer_id = p.stripeCustomerId;
          if (p.stripeSubscriptionId !== undefined) cols.stripe_subscription_id = p.stripeSubscriptionId;
          if (p.currentPeriodEnd !== undefined) cols.current_period_end = p.currentPeriodEnd;
          if (p.cancelAtPeriodEnd !== undefined) cols.cancel_at_period_end = p.cancelAtPeriodEnd;
          await tx`update subscriptions set ${tx(cols)} where user_id = ${userId}`;
          return "saved";
        },
      };
      // Any error rolls back the event id too, so Stripe's retry runs the handler again.
      await apply(writer);
      return true;
    })) as boolean;
  },
};

interface SubscriptionRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: Subscription["plan"];
  status: Subscription["status"];
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

const toSubscription = (r: SubscriptionRow): Subscription => ({
  userId: r.user_id,
  plan: r.plan,
  status: r.status,
  stripeCustomerId: r.stripe_customer_id,
  stripeSubscriptionId: r.stripe_subscription_id,
  currentPeriodEnd: r.current_period_end?.toISOString() ?? null,
  cancelAtPeriodEnd: r.cancel_at_period_end,
});

interface CommentRow {
  thread_id: string;
  item_id: string | null;
  x: number;
  y: number;
  resolved: boolean;
  thread_created_by: string;
  thread_created_at: Date;
  comment_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: Date;
}

async function insertComment(tx: Tx, userId: string, threadId: string, body: string, mentions: string[]): Promise<Comment> {
  const clean = body.trim();
  if (!clean || clean.length > 5000) throw new Error("Comment must be 1 to 5000 characters");
  const id = randomUUID();
  // Row level security checks the caller may comment on the thread's board.
  await tx`insert into comments (id, thread_id, author_id, body) values (${id}, ${threadId}, ${userId}, ${clean})`;
  const ids = mentions.filter((m) => UUID.test(m));
  if (ids.length) await tx`select notify_mentions(${id}, ${ids}::uuid[])`;
  const [me] = await tx<{ name: string }[]>`select name from profiles where id = ${userId}`;
  return { id, authorId: userId, authorName: me?.name ?? "", body: clean, createdAt: new Date().toISOString() };
}

export async function closePostgres() {
  await client?.end();
  client = null;
}
