// Plan limits against every data layer. Postgres runs when TEST_DATABASE_URL is set.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import type { DataLayer } from "../data/types";
import { checkEditorSeat, checkStorage } from "./limits";
import { PLANS } from "../plans";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mysl-limits-"));
const layers: [string, () => Promise<DataLayer>][] = [["local", async () => (await import("../data/local")).localData]];
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  layers.push(["postgres", async () => (await import("../data/postgres")).postgresData]);
  after(async () => (await import("../data/postgres")).closePostgres());
}

const uniq = () => Math.random().toString(36).slice(2, 10);
const MB = 1024 * 1024;

/** Make someone Pro the only way the app can: through a Stripe event. */
async function makePro(data: DataLayer, userId: string) {
  await data.applyStripeEvent({ id: `evt_${uniq()}`, type: "customer.subscription.created" }, (w) =>
    w.saveSubscription(userId, { plan: "pro", status: "active", stripeSubscriptionId: `sub_${uniq()}`, eventAt: new Date().toISOString() }).then(() => {}),
  );
}

async function withBilling<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.STRIPE_SECRET_KEY;
  if (on) process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  else delete process.env.STRIPE_SECRET_KEY;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
}

for (const [name, load] of layers) {
  test(`${name}: Free allows ${PLANS.free.editorsPerBoard} editors per board besides the owner; viewers are unlimited`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`own-${uniq()}@example.com`, "Ольга");
    const board = await data.createBoard(owner.id, "Лимиты");
    const people = await Promise.all([1, 2, 3, 4].map((n) => data.upsertUserByEmail(`ed${n}-${uniq()}@example.com`, `Ред ${n}`)));

    // Two members and one pending invite fill the three seats.
    await data.shareBoard(owner.id, board.id, people[0].email, "editor");
    await data.shareBoard(owner.id, board.id, people[1].email, "editor");
    assert.equal((await checkEditorSeat(data, board.id, { email: `new-${uniq()}@example.com` })).ok, true);
    await data.shareBoard(owner.id, board.id, `pending-${uniq()}@example.com`, "editor");

    const full = await checkEditorSeat(data, board.id, { email: people[2].email });
    assert.deepEqual([full.ok, !full.ok && full.reason], [false, "editors"]);
    assert.equal((await checkEditorSeat(data, board.id, { email: people[0].email.toUpperCase() })).ok, true, "an editor already on the board takes no new seat");
    assert.equal((await checkEditorSeat(data, board.id, { userId: people[1].id })).ok, true);
    assert.equal((await checkEditorSeat(data, board.id, { userId: owner.id })).ok, true);

    // Viewers and commenters do not use seats.
    await data.shareBoard(owner.id, board.id, people[3].email, "viewer");
    assert.equal((await checkEditorSeat(data, board.id, { userId: people[3].id })).ok, false);
    await data.setMemberRole(owner.id, board.id, people[1].id, "commenter");
    assert.equal((await checkEditorSeat(data, board.id, { userId: people[3].id })).ok, true);

    // Pro raises the limit, but only while billing is configured.
    await data.setMemberRole(owner.id, board.id, people[1].id, "editor");
    await makePro(data, owner.id);
    assert.equal((await withBilling(true, () => checkEditorSeat(data, board.id, { email: people[2].email }))).ok, true);
    assert.equal((await withBilling(false, () => checkEditorSeat(data, board.id, { email: people[2].email }))).ok, false);
  });

  test(`${name}: storage counts every board of the owner, whoever uploads`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`st-${uniq()}@example.com`, "Стас");
    const editor = await data.upsertUserByEmail(`st-ed-${uniq()}@example.com`, "Ева");
    const a = await data.createBoard(owner.id, "Первая");
    const b = await data.createBoard(owner.id, "Вторая");
    await data.shareBoard(owner.id, b.id, editor.email, "editor");
    const asset = (boardId: string, bytes: number) => ({ boardId, storagePath: `${boardId}/${uniq()}.png`, mime: "image/png" as const, bytes, width: 1, height: 1 });

    // One file is at most 30 MB, so 60 MB on the first board and 30 MB on the second.
    for (let i = 0; i < 3; i++) await data.createAsset(owner.id, asset(a.id, 20 * MB));
    await data.createAsset(editor.id, asset(b.id, 30 * MB));
    // Someone else's files do not count.
    const other = await data.upsertUserByEmail(`st-o-${uniq()}@example.com`, "Олег");
    await data.createAsset(other.id, asset((await data.createBoard(other.id, "Чужая")).id, 30 * MB));

    const ok = await checkStorage(data, b.id, 10 * MB);
    assert.equal(ok.ok, true);
    assert.equal(ok.used, 90 * MB);
    const over = await checkStorage(data, b.id, 10 * MB + 1);
    assert.deepEqual([over.ok, !over.ok && over.reason, over.plan.storageBytes], [false, "storage", 100 * MB]);

    // Trashed boards still hold their files.
    await data.trashBoard(owner.id, a.id);
    assert.equal((await checkStorage(data, b.id, 11 * MB)).ok, false);

    await makePro(data, owner.id);
    assert.equal((await withBilling(true, () => checkStorage(data, b.id, 500 * MB))).ok, true);
  });

  test(`${name}: an edit link joins as commenter when asked to cap the role`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`ln-${uniq()}@example.com`, "Лена");
    const guest = await data.upsertUserByEmail(`ln-g-${uniq()}@example.com`, "Гость");
    const guest2 = await data.upsertUserByEmail(`ln-g2-${uniq()}@example.com`, "Гость 2");
    const board = await data.createBoard(owner.id, "По ссылке");
    await data.setLinkAccess(owner.id, board.id, "edit");
    const secret = await data.getLinkSecret(owner.id, board.id);
    assert.equal(await data.joinViaLink(guest.id, board.id, { secret, maxRole: "commenter" }), "commenter");
    assert.equal(await data.getRole(board.id, guest.id), "commenter");
    assert.equal(await data.joinViaLink(guest2.id, board.id, { secret }), "editor");
    await data.setLinkAccess(owner.id, board.id, "view");
    const guest3 = await data.upsertUserByEmail(`ln-g3-${uniq()}@example.com`, "Гость 3");
    assert.equal(await data.joinViaLink(guest3.id, board.id, { secret, maxRole: "commenter" }), "viewer", "the cap never raises a role");
  });
}
