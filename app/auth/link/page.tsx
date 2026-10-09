import { t } from "@/lib/copy";
import { finishSignIn } from "@/app/login/actions";

export const metadata = { title: "Вход", robots: { index: false, follow: false } };

// Where the link from the sign-in email leads. Opening the page changes nothing: mail services open links
// to scan them, and that must not use up a one-time link. Signing in takes the button.
export default async function SignInLinkPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t: token } = await searchParams;
  return (
    <main className="flex min-h-full items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-lg bg-bg p-8 shadow-pop">
        <h1 className="text-xl font-semibold">{t.login.title}</h1>
        <p className="mb-6 mt-1 text-text-muted">{t.login.linkPage}</p>
        <form action={finishSignIn}>
          <input type="hidden" name="t" value={token ?? ""} />
          <button type="submit" className="h-10 w-full rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-hover">
            {t.login.submit}
          </button>
        </form>
      </div>
    </main>
  );
}
