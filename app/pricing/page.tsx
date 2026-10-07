import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { currentUser } from "@/lib/session";
import { data } from "@/lib/data";
import { t } from "@/lib/copy";
import { PLANS, effectivePlan, formatBytes, type Plan } from "@/lib/plans";
import { billingEnabled, checkoutReady } from "@/lib/billing/stripe";
import { startCheckout } from "@/app/account/billing/actions";

export const metadata = { title: "Тарифы" };

export default async function PricingPage() {
  const user = await currentUser();
  const current = user ? effectivePlan(await data.getSubscription(user.id), billingEnabled()) : null;
  const ready = checkoutReady();

  const features = (p: Plan) => [t.pricing.boards, t.pricing.editors(p.editorsPerBoard), t.pricing.guests, t.pricing.storage(formatBytes(p.storageBytes)), t.pricing.export];

  const action = (p: Plan) => {
    if (current?.id === p.id) {
      return <p className="flex h-10 items-center justify-center rounded-md bg-surface-active font-semibold">{t.pricing.current}</p>;
    }
    if (p.id === "free") {
      return (
        <Link href={user ? "/" : "/login"} className="flex h-10 items-center justify-center rounded-md border border-border-input font-semibold hover:bg-surface-hover">
          {user ? t.billing.back : t.pricing.startFree}
        </Link>
      );
    }
    if (!user) {
      return (
        <Link href="/login?next=/pricing" className="flex h-10 items-center justify-center rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-hover">
          {t.pricing.upgrade}
        </Link>
      );
    }
    if (!ready) {
      return (
        <div className="flex flex-col gap-2">
          <button type="button" disabled aria-describedby="billing-off" className="flex h-10 items-center justify-center rounded-md bg-accent font-semibold text-on-accent opacity-60">
            {t.pricing.upgrade}
          </button>
          <p id="billing-off" className="text-sm text-text-muted">{t.billing.notConfigured}</p>
        </div>
      );
    }
    return (
      <form action={startCheckout}>
        <button className="flex h-10 w-full items-center justify-center rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-hover">{t.pricing.upgrade}</button>
      </form>
    );
  };

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-8 px-4 py-8 md:py-12">
      <Link href="/" className="flex w-fit items-center gap-2 text-sm text-text-muted hover:text-text">
        <ArrowLeft size={16} aria-hidden /> {t.product}
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t.pricing.title}</h1>
        <p className="max-w-2xl text-text-muted">{t.pricing.lead}</p>
      </header>

      <ul className="grid gap-4 md:grid-cols-2">
        {[PLANS.free, PLANS.pro].map((p) => (
          <li key={p.id} aria-labelledby={`plan-${p.id}`} className={`flex flex-col gap-4 rounded-lg border bg-bg p-6 ${p.id === "pro" ? "border-accent" : "border-border"}`}>
            <div>
              <h2 id={`plan-${p.id}`} className="text-lg font-semibold">{t.pricing.plans[p.id].name}</h2>
              <p className="text-sm text-text-muted">{t.pricing.plans[p.id].tagline}</p>
            </div>
            <p>
              <span className="text-3xl font-semibold">{p.priceLabel}</span> <span className="text-text-muted">{p.pricePeriod}</span>
            </p>
            <ul className="flex flex-1 flex-col gap-2 text-sm">
              {features(p).map((f) => (
                <li key={f} className="flex gap-2">
                  <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-success" /> {f}
                </li>
              ))}
            </ul>
            {action(p)}
          </li>
        ))}
      </ul>

      <section aria-labelledby="faq" className="flex flex-col gap-4">
        <h2 id="faq" className="text-lg font-semibold">{t.pricing.questions}</h2>
        <dl className="grid gap-4 md:grid-cols-2">
          {t.pricing.faq.map((f) => (
            <div key={f.q} className="flex flex-col gap-1">
              <dt className="font-semibold">{f.q}</dt>
              <dd className="text-sm text-text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
