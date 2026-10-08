// Public address of the site for metadata, the sitemap and robots.txt. Set NEXT_PUBLIC_SITE_URL in production.
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
