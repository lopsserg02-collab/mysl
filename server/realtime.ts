// Realtime server: one Yjs document per board, synced over WebSocket with Hocuspocus.
// Development storage is a file per board under .data/docs; the Supabase stage swaps fetch/store for board_docs.
import { promises as fs } from "node:fs";
import path from "node:path";
import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { verify, type RealtimeClaims } from "../lib/token";

const DOCS_DIR = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "docs");
const port = Number(process.env.REALTIME_PORT ?? 1234);
const ID = /^board:([0-9a-f-]{36})$/;

function fileFor(documentName: string) {
  const m = ID.exec(documentName);
  if (!m) throw new Error("Unknown document");
  return path.join(DOCS_DIR, `${m[1]}.bin`);
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
  extensions: [
    new Database({
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
    }),
  ],
});

server.listen().then(() => console.log(`realtime listening on ws://localhost:${port}`));
