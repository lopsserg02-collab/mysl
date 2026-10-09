import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { legalReady } from "@/lib/legal";

// Public pages only. The legal pages join once the operator's details are filled in (lib/legal.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const legal = legalReady ? ["/terms", "/privacy", "/consent"] : [];
  return [
    { url: `${siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    ...legal.map((p) => ({ url: `${siteUrl}${p}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
