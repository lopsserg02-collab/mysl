import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { t } from "@/lib/copy";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Вход" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentUser()) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return (
    <main className="flex min-h-full items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-lg bg-bg p-8 shadow-pop">
        <h1 className="text-xl font-semibold">{t.login.title}</h1>
        <p className="mb-6 mt-1 text-text-muted">{t.login.lead}</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
