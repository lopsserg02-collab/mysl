import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { devSignInEnabled, supabaseAuthEnabled } from "@/lib/auth-config";
import { safeNext } from "@/lib/safe-next";
import { t } from "@/lib/copy";
import { DevLoginForm, MagicLinkForm } from "./LoginForm";

export const metadata = { title: "Вход" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (await currentUser()) redirect(safeNext(next));
  const supabase = supabaseAuthEnabled();
  const dev = devSignInEnabled();
  return (
    <main className="flex min-h-full items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-lg bg-bg p-8 shadow-pop">
        <h1 className="text-xl font-semibold">{t.login.title}</h1>
        <p className="mb-6 mt-1 text-text-muted">{t.login.lead}</p>
        {error && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {error === "google" ? t.login.errorGoogle : t.login.errorLink}
          </p>
        )}
        {supabase && <MagicLinkForm next={next} />}
        {supabase && dev && <h2 className="mb-4 mt-8 border-t border-border pt-6 text-sm font-semibold">{t.login.devTitle}</h2>}
        {dev && <DevLoginForm next={next} />}
      </div>
    </main>
  );
}
