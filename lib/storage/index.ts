import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

// Where uploaded bytes live. Supabase Storage when the service key is set and the Postgres layer is on,
// otherwise files under .data/assets for development. Access checks happen before either is called.
export interface Storage {
  put(storagePath: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(storagePath: string): Promise<Uint8Array | null>;
}

const SAFE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

const local: Storage = {
  async put(p, bytes) {
    if (!SAFE.test(p)) throw new Error("Bad storage path");
    const file = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "assets", p);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  },
  async get(p) {
    if (!SAFE.test(p)) return null;
    try {
      return new Uint8Array(await fs.readFile(path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "assets", p)));
    } catch {
      return null;
    }
  },
};

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "assets";

// The bucket stays private: only the server, with the service key, reads and writes it.
const supabase: Storage = {
  async put(p, bytes, mime) {
    if (!SAFE.test(p)) throw new Error("Bad storage path");
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${p}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": mime, "x-upsert": "false" },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
  },
  async get(p) {
    if (!SAFE.test(p)) return null;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${p}`, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  },
};

export const storage: Storage =
  process.env.DATA_LAYER === "postgres" && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL ? supabase : local;

/** Image type from the file's first bytes, not from what the browser claims. SVG is refused: it can carry scripts. */
export function sniffImage(b: Uint8Array): { mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; ext: string } | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", ext: "png" };
  if (at(0, 0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return { mime: "image/gif", ext: "gif" };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { mime: "image/webp", ext: "webp" };
  return null;
}

export const MAX_UPLOAD = 30 * 1024 * 1024;
