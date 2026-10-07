import { NextResponse } from "next/server";
import { data } from "@/lib/data";
import { handleStripeEvent, verifyEvent } from "@/lib/billing/webhook";

// Stripe calls this for subscription changes. The raw body is verified against STRIPE_WEBHOOK_SECRET
// before anything is read from it; each event id is applied once.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  const raw = await req.text();
  let event;
  try {
    event = verifyEvent(raw, req.headers.get("stripe-signature"), secret);
  } catch {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(data, event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // Nothing was recorded, so Stripe retries the event later.
    console.error("stripe webhook failed", event.id, event.type, e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
