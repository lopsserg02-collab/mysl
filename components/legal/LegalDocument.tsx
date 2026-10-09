import Link from "next/link";
import { t } from "@/lib/copy";
import { siteUrl } from "@/lib/site";
import { LEGAL_EDITION, OPERATOR, legalReady, type Operator } from "@/lib/legal";
import { Wordmark } from "@/components/brand/Logo";

// Layout and building blocks shared by /privacy, /terms and /consent.

export interface TocEntry {
  id: string;
  title: string;
}

export function LegalDocument({ title, toc, children }: { title: string; toc: TocEntry[]; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8">
      <Link href="/" aria-label={t.legal.back}>
        <Wordmark size={28} />
      </Link>
      <main className="mt-10">
        {!legalReady && (
          <p role="note" className="mb-6 rounded-md border border-border bg-warning-subtle p-4 text-base">
            {t.legal.notInForce}
          </p>
        )}
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {t.legal.edition} {LEGAL_EDITION ?? <Fill>дата вступления в силу</Fill>}
        </p>
        <nav aria-label={t.legal.contents} className="mt-6 rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">{t.legal.contents}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {toc.map((e) => (
              <li key={e.id}>
                <a href={`#${e.id}`} className="text-accent hover:underline">{e.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-8 space-y-8 text-base leading-relaxed">{children}</div>
        <p className="mt-10">
          <Link href="/" className="font-semibold text-accent underline underline-offset-4">{t.legal.back}</Link>
        </p>
      </main>
    </div>
  );
}

export function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6">
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** A numbered clause: «3.2. Text». */
export function Clause({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-semibold">{n}.</span> {children}
    </p>
  );
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1 pl-6">{children}</ul>;
}

/** A place that has to be filled in before the document takes effect. */
export function Fill({ children }: { children: React.ReactNode }) {
  return <mark className="rounded-sm bg-warning-subtle px-1 text-text">[{children}]</mark>;
}

const blanks: Record<keyof Operator, string> = {
  name: "наименование или ФИО оператора",
  inn: "ИНН",
  ogrn: "ОГРН / ОГРНИП",
  address: "почтовый адрес",
  email: "адрес электронной почты",
};

/** One of the operator's details, or a highlighted blank while it is not set. */
export function Op({ field }: { field: keyof Operator }) {
  const v = OPERATOR[field];
  if (!v) return <Fill>{blanks[field]}</Fill>;
  if (field === "email") return <a href={`mailto:${v}`} className="text-accent underline underline-offset-2">{v}</a>;
  return <>{v}</>;
}

/** The site's address as a link. */
export function Site() {
  return <a href={siteUrl} className="text-accent underline underline-offset-2">{siteUrl.replace(/^https?:\/\//, "")}</a>;
}

/** Operator details block for the end of each document. */
export function OperatorDetails() {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border p-4 text-sm">
      <dt className="text-text-muted">Оператор</dt>
      <dd><Op field="name" /></dd>
      <dt className="text-text-muted">ИНН</dt>
      <dd><Op field="inn" /></dd>
      <dt className="text-text-muted">ОГРН / ОГРНИП</dt>
      <dd><Op field="ogrn" /></dd>
      <dt className="text-text-muted">Адрес</dt>
      <dd><Op field="address" /></dd>
      <dt className="text-text-muted">Эл. почта</dt>
      <dd><Op field="email" /></dd>
    </dl>
  );
}
