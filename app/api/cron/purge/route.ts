import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { data } from "@/lib/data";
import { storage } from "@/lib/storage";

// Daily job (vercel.json): boards that have been in the trash longer than 30 days are deleted for good,
// with their comments, notifications and stored images that no other board uses.
// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; without CRON_SECRET set the job is off.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!same(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { boards, orphanedFiles } = await data.purgeTrash();
  let filesRemoved = 0;
  try {
    await storage.remove(orphanedFiles);
    filesRemoved = orphanedFiles.length;
  } catch (e) {
    // The boards are gone either way; leftover files are only storage, and are logged for a later clean-up.
    console.error(`[purge] could not delete ${orphanedFiles.length} files: ${(e as Error).message}`, orphanedFiles);
  }
  console.info(`[purge] deleted ${boards} boards, ${filesRemoved} files`);
  return NextResponse.json({ boards, filesRemoved });
}

// Constant-time comparison of the header with the expected value.
function same(a: string, b: string) {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}
