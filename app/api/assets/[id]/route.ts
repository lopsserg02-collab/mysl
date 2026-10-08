import { data, type Asset } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { storage } from "@/lib/storage";

// Serve an image to anyone who can see its board: someone on the board, or a guest holding that
// board's link secret (?k=) while guest viewing is on. A secret opens only its own board's images.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const assetId = (await params).id;
  const k = new URL(req.url).searchParams.get("k");
  const user = await currentUser();
  if (!user && !k) return new Response(null, { status: 401 });
  let asset: Asset | null = user ? await data.getAsset(user.id, assetId) : null;
  if (!asset && k) asset = await data.getGuestAsset(assetId, k);
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
      "Referrer-Policy": "no-referrer",
    },
  });
}
