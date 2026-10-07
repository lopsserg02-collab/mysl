// Stripe webhook handling against every data layer, with events signed the way Stripe signs them.
// Postgres runs when TEST_DATABASE_URL is set.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import Stripe from "stripe";
import type postgresLib from "postgres";
import type { DataLayer } from "../data/types";
import { handleStripeEvent, verifyEvent } from "./webhook";
import { effectivePlan } from "../plans";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mysl-billing-"));
const layers: [string, () => Promise<DataLayer>][] = [["local", async () => (await import("../data/local")).localData]];
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  layers.push(["postgres", async () => (await import("../data/postgres")).postgresData]);
  after(async () => (await import("../data/postgres")).closePostgres());
}

const SECRET = "whsec_test_fixture_secret";
const uniq = () => Math.random().toString(36).slice(2, 10);
const T0 = 1_790_000_000; // a fixed "now" for event times, in seconds

function fixture(type: string, object: Record<string, unknown>, created = T0, id = `evt_${uniq()}`) {
  return JSON.stringify({ id, object: "event", type, created, api_version: "2026-09-30.endive", livemode: false, data: { object } });
}

/** Sign like Stripe, verify like the route, then handle. */
async function deliver(data: DataLayer, body: string) {
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return handleStripeEvent(data, verifyEvent(body, header, SECRET));
}

const subscription = (id: string, customer: string, userId: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  object: "subscription",
  customer,
  status,
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: { userId },
  items: { object: "list", data: [{ id: `si_${uniq()}`, object: "subscription_item", current_period_end: T0 + 30 * 86400 }] },
  ...extra,
});

test("signature: a wrong secret, a changed body or no header is refused", () => {
  const body = fixture("invoice.payment_failed", { id: "in_1", object: "invoice", customer: "cus_x" });
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  assert.ok(verifyEvent(body, header, SECRET));
  assert.throws(() => verifyEvent(body, header, "whsec_other"));
  assert.throws(() => verifyEvent(body.replace("cus_x", "cus_y"), header, SECRET));
  assert.throws(() => verifyEvent(body, null, SECRET));
  const old = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
  assert.throws(() => verifyEvent(body, old, SECRET));
});

for (const [name, load] of layers) {
  test(`${name}: checkout, renewal state, failed payment and cancel, each event applied once`, async () => {
    const data = await load();
    const user = await data.upsertUserByEmail(`pay-${uniq()}@example.com`, "Павел");
    const customer = `cus_${uniq()}`;
    const subId = `sub_${uniq()}`;
    await data.setStripeCustomer(user.id, customer);
    assert.equal(effectivePlan(await data.getSubscription(user.id), true).id, "free");

    const checkout = fixture("checkout.session.completed", {
      id: `cs_${uniq()}`, object: "checkout.session", mode: "subscription", customer, subscription: subId,
      client_reference_id: user.id, payment_status: "paid", metadata: { userId: user.id },
    });
    assert.equal(await deliver(data, checkout), "processed");
    let sub = await data.getSubscription(user.id);
    assert.equal(sub?.plan, "pro");
    assert.equal(sub?.status, "active");
    assert.equal(sub?.stripeSubscriptionId, subId);
    assert.equal(effectivePlan(sub, true).id, "pro");

    // The same delivery again changes nothing.
    const before = await data.getSubscription(user.id);
    assert.equal(await deliver(data, checkout), "duplicate");
    assert.deepEqual(await data.getSubscription(user.id), before);

    const updated = fixture("customer.subscription.updated", subscription(subId, customer, user.id, "active", { cancel_at_period_end: true }), T0 + 10);
    assert.equal(await deliver(data, updated), "processed");
    sub = await data.getSubscription(user.id);
    assert.equal(sub?.cancelAtPeriodEnd, true);
    assert.equal(sub?.currentPeriodEnd, new Date((T0 + 30 * 86400) * 1000).toISOString());

    const failed = fixture("invoice.payment_failed", { id: `in_${uniq()}`, object: "invoice", customer }, T0 + 20);
    assert.equal(await deliver(data, failed), "processed");
    sub = await data.getSubscription(user.id);
    assert.equal(sub?.status, "past_due");
    assert.equal(effectivePlan(sub, true).id, "pro", "Pro stays while Stripe retries the card");

    const deleted = fixture("customer.subscription.deleted", subscription(subId, customer, user.id, "canceled"), T0 + 30);
    assert.equal(await deliver(data, deleted), "processed");
    sub = await data.getSubscription(user.id);
    assert.equal(sub?.status, "canceled");
    assert.equal(sub?.cancelAtPeriodEnd, false);
    assert.equal(effectivePlan(sub, true).id, "free");

    // Replays and late, older events cannot bring Pro back.
    const after = await data.getSubscription(user.id);
    assert.equal(await deliver(data, checkout), "duplicate");
    assert.equal(await deliver(data, updated), "duplicate");
    assert.equal(await deliver(data, deleted), "duplicate");
    const late = fixture("customer.subscription.updated", subscription(subId, customer, user.id, "active"), T0 + 5);
    assert.equal(await deliver(data, late), "processed");
    assert.deepEqual(await data.getSubscription(user.id), after);
  });

  test(`${name}: unknown customers are recorded and skipped; an old subscription cannot cancel a new one`, async () => {
    const data = await load();
    assert.equal(await deliver(data, fixture("customer.subscription.updated", subscription(`sub_${uniq()}`, `cus_${uniq()}`, "not-a-user", "active"))), "ignored");
    assert.equal(await deliver(data, fixture("invoice.payment_failed", { id: "in_2", object: "invoice", customer: `cus_${uniq()}` })), "ignored");
    assert.equal(await deliver(data, fixture("customer.created", { id: `cus_${uniq()}`, object: "customer" })), "ignored");

    const user = await data.upsertUserByEmail(`again-${uniq()}@example.com`, "Вера");
    const customer = `cus_${uniq()}`;
    await data.setStripeCustomer(user.id, customer);
    const oldSub = `sub_${uniq()}`;
    const newSub = `sub_${uniq()}`;
    await deliver(data, fixture("customer.subscription.created", subscription(newSub, customer, user.id, "active"), T0 + 100));
    assert.equal((await data.getSubscription(user.id))?.stripeSubscriptionId, newSub);
    assert.equal(await deliver(data, fixture("customer.subscription.deleted", subscription(oldSub, customer, user.id, "canceled"), T0 + 200)), "ignored");
    assert.equal((await data.getSubscription(user.id))?.status, "active");
  });

  test(`${name}: the subscription id is linked through metadata when the customer is new to us`, async () => {
    const data = await load();
    const user = await data.upsertUserByEmail(`meta-${uniq()}@example.com`, "Мира");
    const body = fixture("customer.subscription.created", subscription(`sub_${uniq()}`, `cus_${uniq()}`, user.id, "trialing"));
    assert.equal(await deliver(data, body), "processed");
    const sub = await data.getSubscription(user.id);
    assert.equal(sub?.status, "trialing");
    assert.equal(effectivePlan(sub, true).id, "pro");
    assert.equal(effectivePlan(sub, false).id, "free", "with billing off everyone is on Free");
  });
}

if (process.env.TEST_DATABASE_URL) {
  test("postgres: a person reads only their own subscription and cannot write it", async () => {
    const { postgresData: data } = await import("../data/postgres");
    const postgres = (await import("postgres")).default;
    const a = await data.upsertUserByEmail(`rls-a-${uniq()}@example.com`, "А");
    const b = await data.upsertUserByEmail(`rls-b-${uniq()}@example.com`, "Б");
    await data.setStripeCustomer(a.id, `cus_${uniq()}`);
    assert.ok(await data.getSubscription(a.id));
    assert.equal(await data.getSubscription(b.id), null);

    const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const as = (uid: string, q: (tx: postgresLib.TransactionSql) => Promise<unknown>) =>
        sql.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
          await tx.unsafe("set local role authenticated");
          return q(tx);
        });
      assert.equal(((await as(b.id, (tx) => tx`select * from subscriptions where user_id = ${a.id}`)) as unknown[]).length, 0);
      await assert.rejects(as(a.id, (tx) => tx`update subscriptions set plan = 'pro', status = 'active' where user_id = ${a.id}`), /permission denied/);
      await assert.rejects(as(b.id, (tx) => tx`insert into subscriptions (user_id, plan, status) values (${b.id}, 'pro', 'active')`), /permission denied/);
      await assert.rejects(as(b.id, (tx) => tx`insert into stripe_events (id, type) values ('evt_fake', 'x')`), /permission denied/);
    } finally {
      await sql.end();
    }
  });
}
