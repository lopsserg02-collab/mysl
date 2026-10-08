import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/site";
import { t } from "@/lib/copy";
import { OfflineSupport } from "@/components/OfflineSupport";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: t.product, template: `%s · ${t.product}` },
  description: t.landing.metaDescription,
  applicationName: t.product,
  openGraph: { type: "website", locale: "ru_RU", siteName: t.product },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121418" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-bg text-text antialiased">
        {children}
        <OfflineSupport />
      </body>
    </html>
  );
}
