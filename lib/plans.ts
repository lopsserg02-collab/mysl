// Plans and their limits, in one place. The server enforces these; the pricing page shows them.
// Free has no board cap on purpose (fixes.md #3): it limits editors per board and total storage instead.
//
// TODO(prices): the price labels below are placeholders until the owner approves them.
// The amount actually charged comes from the Stripe Price in STRIPE_PRICE_PRO, not from this file.

export type PlanId = "free" | "pro";

export interface Plan {
  id: PlanId;
  /** People who may edit a board besides its owner (editors and co-owners, pending editor invites included). */
  editorsPerBoard: number;
  /** All uploads on every board the person owns, in bytes. */
  storageBytes: number;
  /** Placeholder price text, shown on /pricing. */
  priceLabel: string;
  pricePeriod: string;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", editorsPerBoard: 3, storageBytes: 100 * MB, priceLabel: "0 ₽", pricePeriod: "навсегда" },
  pro: { id: "pro", editorsPerBoard: 50, storageBytes: 10 * GB, priceLabel: "490 ₽", pricePeriod: "в месяц" },
};

/** Stripe statuses that keep Pro. past_due keeps it while Stripe retries the card; the final failure cancels. */
export const PAID_STATUSES = ["active", "trialing", "past_due"] as const;

export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "incomplete_expired" | "unpaid" | "paused";

/** The plan a person is on, from their subscription row. With billing switched off, everyone is on Free. */
export function effectivePlan(sub: { plan: PlanId; status: SubscriptionStatus } | null, billingOn: boolean): Plan {
  if (!billingOn || !sub || sub.plan !== "pro") return PLANS.free;
  return (PAID_STATUSES as readonly string[]).includes(sub.status) ? PLANS.pro : PLANS.free;
}

/** "100 МБ", "1,5 ГБ" */
export function formatBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`;
  if (n >= MB) return `${(n / MB).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${Math.ceil(n / 1024)} КБ`;
}
