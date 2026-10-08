import { serviceWorkerSource } from "@/lib/offline/sw";

// Built once per deploy; the version names the caches, so a new build drops the old ones.
export const dynamic = "force-static";

export function GET() {
  return new Response(serviceWorkerSource(process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev"), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Security-Policy": "default-src 'self'",
    },
  });
}
