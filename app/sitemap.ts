import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Public pages only. /terms and /privacy join once they stop being drafts.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/pricing`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
