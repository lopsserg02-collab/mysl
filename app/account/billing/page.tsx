import Link from "next/link";
import { AlertTriangle, ArrowLeft, CreditCard, XCircle } from "lucide-react";
import { data } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { t } from "@/lib/copy";
import { effectivePlan, formatBytes } from "@/lib/plans";
import { billingEnabled, checkoutReady } from "@/lib/billing/stripe";
import { openPortal, startCheckout } from "./actions";

export const metadata = { title: "Тариф и оплата" };

const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string; billing?: string }> }) {
  const user = await requireUser("/account/billing");
  const sp = await searchParams;
  const sub = await data.getSubscription(user.id);
  const plan = effectivePlan(sub, billingEnabled());
  const ready = checkoutReady();
  const pro = plan.id === "pro";

  const notice =
    sp.error ? { text: t.billing.error, error: true } : sp.checkout === "done" ? { text: t.billing.checkoutDone } : sp.checkout === "canceled" ? { text: t.billing.checkoutCanceled } : null;

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-4 py-8 md:py-12">
      <Link href="/" className="flex w-fit items-center gap-2 text-sm text-text-muted hover:text-text">
        <ArrowLeft size={16} aria-hidden /> {t.billing.back}
      </Link>
      <h1 className="text-2xl font-semibold">{t.billing.title}</h1>

      {notice && (
        <p role={notice.error ? "alert" : "status"} className={`rounded-md px-4 py-3 text-sm ${notice.error ? "bg-danger-subtle text-danger" : "bg-success-subtle"}`}>
          {notice.text}
        </p>
      )}

      <section aria-labelledby="current-plan" className="flex flex-col gap-4 rounded-lg border border-border p-6">
        <div>
          <p id="current-plan" className="text-sm text-text-muted">{t.billing.current}</p>
          <p className="text-xl font-semibold">{t.billing.planName[plan.id]}</p>
          <p className="mt-1 text-sm text-text-muted">{t.billing.limits(plan.editorsPerBoard, formatBytes(plan.storageBytes))}</p>
        </div>

        {pro && sub?.status === "past_due" && (
          <p role="alert" className="flex gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-warning" /> {t.billing.pastDue}
          </p>
        )}
        {pro && sub?.currentPeriodEnd && (
          <p className="text-sm">{sub.cancelAtPeriodEnd ? t.billing.endsOn(date(sub.currentPeriodEnd)) : t.billing.renews(date(sub.currentPeriodEnd))}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {!pro && ready && (
            <form action={startCheckout}>
              <button className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover">
                <CreditCard size={16} aria-hidden /> {t.billing.upgrade}
              </button>
            </form>
          )}
          {!pro && !ready && (
            <button type="button" disabled aria-describedby="billing-off" className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-on-accent opacity-60">
              <CreditCard size={16} aria-hidden /> {t.billing.upgrade}
            </button>
          )}
          {ready && sub?.stripeCustomerId && (
            <form action={openPortal}>
              <button className="flex h-10 items-center gap-2 rounded-md border border-border-input px-4 font-semibold hover:bg-surface-hover">{t.billing.manage}</button>
            </form>
          )}
          {ready && pro && sub?.stripeSubscriptionId && !sub.cancelAtPeriodEnd && (
            <form action={openPortal}>
              <input type="hidden" name="flow" value="cancel" />
              <button className="flex h-10 items-center gap-2 rounded-md border border-border-input px-4 font-semibold text-danger hover:bg-danger-subtle">
                <XCircle size={16} aria-hidden /> {t.billing.cancel}
              </button>
            </form>
          )}
        </div>
        {!ready && <p id="billing-off" className="text-sm text-text-muted">{t.billing.notConfigured}</p>}
        {ready && pro && !sub?.cancelAtPeriodEnd && <p className="text-sm text-text-muted">{t.billing.cancelHint}</p>}
      </section>

      <Link href="/pricing" className="w-fit text-sm font-medium text-accent underline underline-offset-2">{t.billing.seePlans}</Link>
    </main>
  );
}
