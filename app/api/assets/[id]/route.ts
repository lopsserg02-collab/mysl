import { data } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { storage } from "@/lib/storage";

// Serve an image to anyone who can see its board.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const asset = await data.getAsset(user.id, (await params).id);
  const bytes = asset && (await storage.get(asset.storagePath));
  if (!asset || !bytes) return new Response(null, { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(bytes.length),
      // Private: access can be taken away, so shared caches must not keep it. Content never changes.
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
