// Stripe webhook handling. The signature is checked first; then each event runs once (its id is
// recorded in the same transaction as the change), and older events never overwrite newer ones.
// Subscription status comes only from here, never from the browser.
import Stripe from "stripe";
import { PAID_STATUSES, type SubscriptionStatus } from "../plans";
import type { BillingWriter, DataLayer } from "../data/types";

export type WebhookResult = "processed" | "duplicate" | "ignored";

/** Throws when the signature is missing, wrong or older than Stripe's 5-minute tolerance. */
export function verifyEvent(rawBody: string, signature: string | null, secret: string): Stripe.Event {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

const STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"];
const toStatus = (s: string): SubscriptionStatus => (STATUSES.includes(s as SubscriptionStatus) ? (s as SubscriptionStatus) : "incomplete");
const isPaid = (s: string) => (PAID_STATUSES as readonly string[]).includes(s);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : (x?.id ?? null));

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export async function handleStripeEvent(data: DataLayer, event: Stripe.Event): Promise<WebhookResult> {
  const eventAt = new Date(event.created * 1000).toISOString();
  let result: WebhookResult = "ignored";

  // The checkout customer is linked to the person by our server before payment; the user id we put in the
  // session and subscription metadata is the fallback. Known people only (looked up before the transaction):
  // an event for someone who no longer exists is recorded and skipped, not retried forever.
  const obj = event.data.object as { client_reference_id?: string | null; metadata?: Record<string, string> | null };
  const hinted = obj.client_reference_id ?? obj.metadata?.userId;
  const metaUser = hinted && /^[0-9a-f-]{36}$/i.test(hinted) && (await data.getUser(hinted)) ? hinted : null;
  const owner = async (w: BillingWriter, customer: string | null) => (customer ? await w.userIdForCustomer(customer) : null) ?? metaUser;

  const fresh = await data.applyStripeEvent({ id: event.id, type: event.type }, async (w) => {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.mode !== "subscription") return;
        const customer = idOf(s.customer);
        const userId = await owner(w, customer);
        if (!userId) return;
        const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
        await w.saveSubscription(userId, {
          plan: "pro",
          status: paid ? "active" : "incomplete",
          stripeCustomerId: customer,
          stripeSubscriptionId: idOf(s.subscription),
          eventAt,
        });
        result = "processed";
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const userId = await owner(w, idOf(sub.customer));
        if (!userId) return;
        const status = event.type === "customer.subscription.deleted" ? "canceled" : toStatus(sub.status);
        // A late event about an old subscription must not touch the person's current one.
        const current = await w.getSubscription(userId);
        if (current?.stripeSubscriptionId && current.stripeSubscriptionId !== sub.id && !isPaid(status)) return;
        const ends = sub.items?.data?.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number") ?? [];
        await w.saveSubscription(userId, {
          plan: "pro",
          status,
          stripeCustomerId: idOf(sub.customer),
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : (current?.currentPeriodEnd ?? null),
          cancelAtPeriodEnd: status !== "canceled" && (sub.cancel_at_period_end || Boolean(sub.cancel_at)),
          eventAt,
        });
        result = "processed";
        return;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customer = idOf(invoice.customer);
        const userId = customer ? await w.userIdForCustomer(customer) : null;
        if (!userId) return;
        const current = await w.getSubscription(userId);
        // Pro stays while Stripe retries the card; the billing page asks to update it.
        if (!current || (current.status !== "active" && current.status !== "trialing")) return;
        await w.saveSubscription(userId, { status: "past_due", eventAt });
        result = "processed";
        return;
      }
    }
  });
  return fresh ? result : "duplicate";
}
