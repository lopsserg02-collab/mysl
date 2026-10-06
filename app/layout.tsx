import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Мысль", template: "%s · Мысль" },
  description: "Онлайн-доска для совместной работы",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
