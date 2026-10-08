"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { data } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { effectivePlan } from "@/lib/plans";
import { checkoutReady, stripe } from "@/lib/billing/stripe";

const PAGE = "/account/billing";

async function origin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** Sends the person to Stripe Checkout for Pro. The plan changes only when Stripe's webhook confirms payment. */
export async function startCheckout() {
  const user = await requireUser("/pricing");
  if (!checkoutReady()) redirect(`${PAGE}?billing=off`);
  const sub = await data.getSubscription(user.id);
  if (effectivePlan(sub, true).id === "pro") redirect(PAGE);
  const base = await origin();
  let url: string | null = null;
  try {
    let customer = sub?.stripeCustomerId ?? null;
    if (!customer) {
      // The same key for the same person: a double click cannot create two customers.
      const c = await stripe().customers.create({ email: user.email, metadata: { userId: user.id } }, { idempotencyKey: `mysl-customer-${user.id}` });
      customer = c.id;
      await data.setStripeCustomer(user.id, customer);
    }
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price: process.env.STRIPE_PRICE_PRO!, quantity: 1 }],
      metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
      locale: "ru",
      success_url: `${base}${PAGE}?checkout=done`,
      cancel_url: `${base}${PAGE}?checkout=canceled`,
    });
    url = session.url;
  } catch (e) {
    console.error("stripe checkout failed", e);
  }
  redirect(url ?? `${PAGE}?error=1`);
}

/** Stripe Customer Portal. With flow=cancel it opens straight on the cancel confirmation: one click to cancel. */
export async function openPortal(form: FormData) {
  const user = await requireUser(PAGE);
  if (!checkoutReady()) redirect(`${PAGE}?billing=off`);
  const sub = await data.getSubscription(user.id);
  if (!sub?.stripeCustomerId) redirect(PAGE);
  const cancel = form.get("flow") === "cancel" && sub.stripeSubscriptionId;
  const back = `${await origin()}${PAGE}`;
  let url: string | null = null;
  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: back,
      locale: "ru",
      ...(cancel
        ? { flow_data: { type: "subscription_cancel" as const, subscription_cancel: { subscription: sub.stripeSubscriptionId! }, after_completion: { type: "redirect" as const, redirect: { return_url: back } } } }
        : {}),
    });
    url = session.url;
  } catch (e) {
    console.error("stripe portal failed", e);
  }
  redirect(url ?? `${PAGE}?error=1`);
}
