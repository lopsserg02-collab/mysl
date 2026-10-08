// Stripe client and configuration. Billing is on only when STRIPE_SECRET_KEY is set;
// without it everyone is on Free and the upgrade button says payments are not set up yet.
import Stripe from "stripe";

export const billingEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

/** Checkout needs the key and the Pro price id. */
export const checkoutReady = () => billingEnabled() && Boolean(process.env.STRIPE_PRICE_PRO);

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key, { appInfo: { name: "Mysl" } });
  return client;
}
