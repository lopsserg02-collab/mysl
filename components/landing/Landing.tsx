import Link from "next/link";
import { ArrowRight, BellOff, ChevronDown, Gauge, Infinity as InfinityIcon, Mail, MousePointerClick, SquarePlus, Users } from "lucide-react";
import { t } from "@/lib/copy";
import { Wordmark } from "@/components/brand/Logo";

const L = t.landing;
const featureIcons = [Gauge, BellOff, InfinityIcon, MousePointerClick];
const stepIcons = [Mail, SquarePlus, Users];

const primary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-md bg-accent px-6 text-base font-semibold text-on-accent hover:bg-accent-hover";
const secondary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border-input px-6 text-base font-semibold hover:bg-surface-hover";

// The page signed-out visitors see at /. Server component, no client JS.
export function Landing() {
  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-bg focus:px-4 focus:py-2">
        К содержанию
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 md:px-8">
          <Link href="/" aria-label="Мысль, на главную" className="shrink-0">
            <Wordmark size={32} />
          </Link>
          <nav aria-label={L.nav.label} className="ml-auto flex items-center gap-1 text-sm">
            <a href="#features" className="hidden rounded-md px-3 py-2 hover:bg-surface-hover md:inline-block">{L.nav.features}</a>
            <a href="#how" className="hidden rounded-md px-3 py-2 hover:bg-surface-hover md:inline-block">{L.nav.how}</a>
            <Link href="/pricing" className="rounded-md px-3 py-2 hover:bg-surface-hover">{L.nav.pricing}</Link>
            <a href="#faq" className="hidden rounded-md px-3 py-2 hover:bg-surface-hover md:inline-block">{L.nav.faq}</a>
            <Link href="/login" className="ml-2 rounded-md border border-border-input px-4 py-2 font-semibold hover:bg-surface-hover">{L.nav.signIn}</Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section aria-labelledby="hero-title" className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-16 md:px-8 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <h1 id="hero-title" className="text-[2.5rem] font-bold leading-[1.1] tracking-tight md:text-[3.25rem]">{L.hero.title}</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-text-muted">{L.hero.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={primary}>
                {L.hero.cta} <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href="/pricing" className={secondary}>{L.hero.secondary}</Link>
            </div>
            <p className="mt-4 text-sm text-text-muted">{L.hero.note}</p>
          </div>
          <BoardPicture />
        </section>

        <section id="features" aria-labelledby="features-title" className="border-t border-border bg-surface">
          <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-8 lg:py-20">
            <h2 id="features-title" className="text-xl font-bold md:text-[2rem] md:leading-10">{L.featuresTitle}</h2>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {L.features.map((f, i) => {
                const Icon = featureIcons[i];
                return (
                  <li key={f.title} className="rounded-lg border border-border bg-bg p-6 shadow-card">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-subtle text-accent">
                      <Icon size={20} aria-hidden />
                    </span>
                    <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                    <p className="mt-2 text-base text-text-muted">{f.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1200px] px-4 py-16 md:px-8 lg:py-20">
          <h2 id="how-title" className="text-xl font-bold md:text-[2rem] md:leading-10">{L.howTitle}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {L.how.map((s, i) => {
              const Icon = stepIcons[i];
              return (
                <li key={s.title} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border border-border-input text-base font-bold" aria-hidden>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-semibold">
                      <Icon size={18} aria-hidden className="text-accent" /> {s.title}
                    </h3>
                    <p className="mt-1 text-base text-text-muted">{s.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-labelledby="pricing-title" className="border-y border-border bg-accent-subtle">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-6 px-4 py-14 md:flex-row md:items-center md:px-8">
            <div className="flex-1">
              <h2 id="pricing-title" className="text-xl font-bold">{L.pricingTitle}</h2>
              <p className="mt-2 max-w-2xl text-base">{L.pricingBody}</p>
            </div>
            <Link href="/pricing" className={secondary + " bg-bg"}>
              {L.pricingLink} <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-[880px] px-4 py-16 md:px-8 lg:py-20">
          <h2 id="faq-title" className="text-xl font-bold md:text-[2rem] md:leading-10">{L.faqTitle}</h2>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {L.faq.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown size={20} aria-hidden className="shrink-0 text-text-muted transition-transform group-open:rotate-180" />
                </summary>
                <p className="pb-5 text-base text-text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="final-title" className="bg-surface">
          <div className="mx-auto flex max-w-[1200px] flex-col items-center px-4 py-16 text-center md:px-8">
            <h2 id="final-title" className="text-xl font-bold md:text-[2rem] md:leading-10">{L.finalTitle}</h2>
            <p className="mt-3 text-base text-text-muted">{L.finalBody}</p>
            <Link href="/login" className={primary + " mt-8"}>
              {L.hero.cta} <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-8 text-sm text-text-muted md:flex-row md:items-center md:px-8">
          <span>{L.footer.rights}</span>
          <nav aria-label={L.footer.label} className="flex flex-wrap gap-x-6 gap-y-2 md:ml-auto">
            <Link href="/pricing" className="hover:text-text hover:underline">{L.footer.pricing}</Link>
            <Link href="/terms" className="hover:text-text hover:underline">{L.footer.terms}</Link>
            <Link href="/privacy" className="hover:text-text hover:underline">{L.footer.privacy}</Link>
            <Link href="/login" className="hover:text-text hover:underline">{L.footer.signIn}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// A drawn picture of a board (not a screenshot): stickies in the board's own colours, joined by arrows.
function BoardPicture() {
  const s = L.stickies;
  const note = "absolute flex h-[26%] w-[27%] items-center justify-center rounded-xs p-2 text-center text-sm font-medium leading-5 shadow-card";
  return (
    <figure
      role="img"
      aria-label={L.hero.pictureLabel}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-canvas-bg shadow-pop"
      style={{ backgroundImage: "radial-gradient(var(--color-canvas-grid) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
    >
      <svg viewBox="0 0 400 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <marker id="lp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="var(--color-text-muted)" />
          </marker>
        </defs>
        <g fill="none" stroke="var(--color-text-muted)" strokeWidth="1.6" markerEnd="url(#lp-arrow)">
          <path d="M150 62 C 185 62, 195 62, 228 62" />
          <path d="M96 100 C 96 130, 96 140, 96 160" />
          <path d="M150 196 C 190 196, 200 170, 228 160" />
          <path className="hidden sm:inline" d="M282 82 C 282 100, 282 106, 282 122" />
          <path className="sm:hidden" d="M282 82 L 282 218" />
          <path className="hidden sm:inline" d="M282 206 L 282 212" />
        </g>
      </svg>
      <div className={`${note} left-[6%] top-[8%] -rotate-2 bg-sticky-apricot text-sticky-apricot-text`}>{s[0]}</div>
      <div className={`${note} left-[56%] top-[8%] rotate-1 bg-sticky-lilac text-sticky-lilac-text`}>{s[1]}</div>
      <div className={`${note} left-[6%] top-[54%] rotate-1 bg-sticky-coral text-sticky-coral-text`}>{s[2]}</div>
      <div className={`${note} left-[56%] top-[42%] -rotate-1 hidden bg-sticky-sky text-sticky-sky-text sm:flex`}>{s[3]}</div>
      <div className={`${note} left-[56%] top-[72%] bg-sticky-mint text-sticky-mint-text`}>{s[4]}</div>
      <span className="absolute left-[40%] top-[36%] rounded-pill bg-cursor-c6 px-2 py-0.5 text-xs font-medium text-cursor-c6-label">Аня</span>
      <span className="absolute left-[34%] top-[86%] rounded-pill bg-cursor-c4 px-2 py-0.5 text-xs font-medium text-cursor-c4-label">Олег</span>
    </figure>
  );
}
