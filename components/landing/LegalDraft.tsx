import Link from "next/link";
import { t } from "@/lib/copy";
import { Wordmark } from "@/components/brand/Logo";

// Placeholder for a legal page that is not written yet. Replace before the public launch.
export function LegalDraft({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
      <Link href="/" aria-label={t.legal.back}>
        <Wordmark size={28} />
      </Link>
      <main className="mt-10">
        <p className="inline-block rounded-pill bg-warning-subtle px-3 py-1 text-xs font-semibold text-warning">{t.legal.draft}</p>
        <h1 className="mt-4 text-xl font-bold">{title}</h1>
        <p role="note" className="mt-4 rounded-md border border-border bg-surface p-4 text-base">{t.legal.draftNote}</p>
        <div className="mt-6 space-y-4 text-base text-text-muted">{children}</div>
        <p className="mt-10">
          <Link href="/" className="font-semibold text-accent underline underline-offset-4">{t.legal.back}</Link>
        </p>
      </main>
    </div>
  );
}
