import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { data } from "@/lib/data";
import { canEditBoard } from "@/lib/data/types";
import { currentUser } from "@/lib/session";
import { MAX_UPLOAD, sniffImage, storage } from "@/lib/storage";

// Upload one image to a board. Editors only; type is checked from the bytes.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const boardId = z.string().uuid().safeParse(form?.get("boardId"));
  const file = form?.get("file");
  if (!boardId.success || !(file instanceof File)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!canEditBoard(await data.getRole(boardId.data, user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (file.size === 0 || file.size > MAX_UPLOAD) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return NextResponse.json({ error: "unsupported" }, { status: 415 });
  const dim = (k: string) => {
    const n = Number(form?.get(k));
    return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
  };
  const storagePath = `${boardId.data}/${randomUUID()}.${kind.ext}`;
  await storage.put(storagePath, bytes, kind.mime);
  const asset = await data.createAsset(user.id, { boardId: boardId.data, storagePath, mime: kind.mime, bytes: bytes.length, width: dim("width"), height: dim("height") });
  return NextResponse.json({ id: asset.id, src: `/api/assets/${asset.id}` });
}
