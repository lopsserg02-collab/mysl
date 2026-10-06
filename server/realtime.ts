// Realtime server: one Yjs document per board, synced over WebSocket with Hocuspocus.
// Storage: a file per board under .data/docs in development, the board_docs table when DATA_LAYER=postgres.
import { promises as fs } from "node:fs";
import path from "node:path";
import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import postgres from "postgres";
import { verify, type RealtimeClaims } from "../lib/token";

const DOCS_DIR = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "docs");
const port = Number(process.env.REALTIME_PORT ?? 1234);
const ID = /^board:([0-9a-f-]{36})$/;

function fileFor(documentName: string) {
  const m = ID.exec(documentName);
  if (!m) throw new Error("Unknown document");
  return path.join(DOCS_DIR, `${m[1]}.bin`);
}

type Store = ConstructorParameters<typeof Database>[0];

// Development: one file per board.
function fileStore(): Store {
  return {
    fetch: async ({ documentName }) => {
      try {
        return new Uint8Array(await fs.readFile(fileFor(documentName)));
      } catch {
        return null;
      }
    },
    store: async ({ documentName, state }) => {
      const file = fileFor(documentName);
      await fs.mkdir(DOCS_DIR, { recursive: true });
      await fs.writeFile(`${file}.tmp`, state);
      await fs.rename(`${file}.tmp`, file);
    },
  };
}

// Production: board_docs in Postgres. This server is trusted and connects with a role that bypasses RLS;
// it only ever touches the board named in a verified token.
function postgresStore(): Store {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  const idOf = (name: string) => ID.exec(name)![1];
  return {
    fetch: async ({ documentName }) => {
      const [row] = await sql<{ state: Buffer }[]>`select state from board_docs where board_id = ${idOf(documentName)}`;
      return row ? new Uint8Array(row.state) : null;
    },
    store: async ({ documentName, state }) => {
      const id = idOf(documentName);
      await sql.begin(async (tx) => {
        await tx`insert into board_docs (board_id, state, updated_at) values (${id}, ${Buffer.from(state)}, now())
                 on conflict (board_id) do update set state = excluded.state, updated_at = now()`;
        await tx`update boards set content_updated_at = now() where id = ${id}`;
      });
    },
  };
}

const server = new Server<RealtimeClaims>({
  port,
  quiet: true,
  debounce: 1000,
  maxDebounce: 5000,
  async onAuthenticate({ token, documentName, connectionConfig }) {
    const claims = verify<RealtimeClaims>(token);
    if (!claims || `board:${claims.boardId}` !== documentName) throw new Error("Not authorised");
    // Viewers and commenters get a read-only connection: the server drops their document updates.
    connectionConfig.readOnly = !["owner", "coowner", "editor"].includes(claims.role);
    return claims;
  },
  extensions: [new Database(process.env.DATA_LAYER === "postgres" ? postgresStore() : fileStore())],
});

server.listen().then(() => console.log(`realtime listening on ws://localhost:${port}`));
