import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { data, LINK_SECRET } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { sign, type RealtimeClaims } from "@/lib/token";
import { t } from "@/lib/copy";

const Body = z.object({ boardId: z.string().uuid(), k: z.string().regex(LINK_SECRET).optional() });

// Short-lived token the browser hands to the realtime server for one board.
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { boardId, k } = body.data;
  const user = await currentUser();
  if (user) {
    const role = await data.getRole(boardId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const claims: RealtimeClaims = { userId: user.id, name: user.name, boardId, role };
    return NextResponse.json({ token: sign(claims, 60 * 60), role });
  }
  // A guest holding the board's link: read-only, a fresh anonymous id, and a short life, so that turning
  // guest viewing off or making a new link locks them out at their next reconnect.
  const guest = k ? await data.guestBoard(boardId, k) : null;
  if (!guest) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const claims: RealtimeClaims = { userId: `guest:${randomUUID()}`, name: t.guest.name, boardId: guest.id, role: "viewer", guest: true };
  return NextResponse.json({ token: sign(claims, 10 * 60), role: "viewer" });
}
