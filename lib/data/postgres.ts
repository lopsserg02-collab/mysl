// Postgres data layer (Supabase or any Postgres with db/dev/supabase-stub.sql).
// Every user query runs as the `authenticated` role with the user's id in the JWT claims,
// so the row level security policies in db/migrations decide what each person can see and change.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { AccessError, type Board, type BoardListItem, type BoardRole, type DataLayer, type User } from "./types";

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
  return sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx.unsafe("set local role authenticated");
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
    // Metadata only (name for the page title); access is checked separately with getRole.
    const [row] = await sql()<BoardRow[]>`select * from boards where id = ${boardId}`;
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
};

export async function closePostgres() {
  await client?.end();
  client = null;
}
