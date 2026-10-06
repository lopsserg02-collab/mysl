import { NextResponse } from "next/server";
import { z } from "zod";
import { data } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { sign, type RealtimeClaims } from "@/lib/token";

// Short-lived token the browser hands to the realtime server for one board.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = z.object({ boardId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const role = await data.getRole(body.data.boardId, user.id);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const claims: RealtimeClaims = { userId: user.id, name: user.name, boardId: body.data.boardId, role };
  return NextResponse.json({ token: sign(claims, 60 * 60), role });
}
