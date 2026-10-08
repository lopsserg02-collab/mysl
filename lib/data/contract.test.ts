// The same behaviour is required of every data layer. Postgres runs when TEST_DATABASE_URL is set.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import * as Y from "yjs";
import { addItem, addSticky, readAll, type ImageItem } from "../board/model";
import { daysUntilPurge, type DataLayer } from "./types";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mysl-data-"));
const layers: [string, () => Promise<DataLayer>][] = [["local", async () => (await import("./local")).localData]];
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  layers.push(["postgres", async () => (await import("./postgres")).postgresData]);
  after(async () => (await import("./postgres")).closePostgres());
}

const uniq = () => Math.random().toString(36).slice(2, 10);

for (const [name, load] of layers) {
  test(`${name}: owner lifecycle and isolation from a second user`, async () => {
    const data = await load();
    const a = await data.upsertUserByEmail(`a-${uniq()}@example.com`, "Анна");
    const b = await data.upsertUserByEmail(`b-${uniq()}@example.com`, "Борис");
    assert.equal((await data.getUser(a.id))?.name, "Анна");

    const board = await data.createBoard(a.id, "  План  ");
    assert.equal(board.name, "План");
    await data.createBoard(a.id, "Альфа");
    assert.equal(await data.getRole(board.id, a.id), "owner");
    assert.deepEqual((await data.listBoards(a.id, { sort: "name" })).map((x) => x.name), ["Альфа", "План"]);
    assert.deepEqual((await data.listBoards(a.id, { q: "пла" })).map((x) => x.name), ["План"]);

    // The second user sees and changes nothing
    assert.equal(await data.getRole(board.id, b.id), null);
    assert.deepEqual(await data.listBoards(b.id), []);
    await assert.rejects(data.renameBoard(b.id, board.id, "взлом"));
    await assert.rejects(data.setStarred(b.id, board.id, true));
    await assert.rejects(data.trashBoard(b.id, board.id));

    await data.renameBoard(a.id, board.id, "План запуска");
    await data.setStarred(a.id, board.id, true);
    assert.deepEqual((await data.listBoards(a.id, { starredOnly: true })).map((x) => x.name), ["План запуска"]);

    await data.trashBoard(a.id, board.id);
    assert.equal(await data.getRole(board.id, a.id), null);
    assert.deepEqual((await data.listBoards(a.id, { trashed: true })).map((x) => x.id), [board.id]);
    assert.equal((await data.listBoards(a.id)).length, 1);
    await assert.rejects(data.restoreBoard(b.id, board.id));
    await data.restoreBoard(a.id, board.id);
    assert.equal(await data.getRole(board.id, a.id), "owner");
  });
}

for (const [name, load] of layers) {
  test(`${name}: sharing by email, by link, and who may change it`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`o-${uniq()}@example.com`, "Ольга");
    const editor = await data.upsertUserByEmail(`e-${uniq()}@example.com`, "Егор");
    const stranger = await data.upsertUserByEmail(`s-${uniq()}@example.com`, "Света");
    const board = await data.createBoard(owner.id, "Общая");

    // An existing account joins at once; an unknown address waits as an invite.
    assert.equal(await data.shareBoard(owner.id, board.id, editor.email.toUpperCase(), "editor"), "added");
    assert.equal(await data.getRole(board.id, editor.id), "editor");
    const later = `new-${uniq()}@example.com`;
    assert.equal(await data.shareBoard(owner.id, board.id, later, "commenter"), "invited");
    const people = await data.listPeople(editor.id, board.id);
    assert.deepEqual(people.map((p) => [p.role, p.pending]), [["owner", false], ["editor", false], ["commenter", true]]);

    // The invite becomes membership on sign-up.
    const newcomer = await data.upsertUserByEmail(later, "Новенький");
    assert.equal(await data.getRole(board.id, newcomer.id), "commenter");
    assert.equal((await data.listPeople(owner.id, board.id)).filter((p) => p.pending).length, 0);

    // Only owners and co-owners change access, and nobody changes the owner.
    await assert.rejects(data.shareBoard(editor.id, board.id, stranger.email, "editor"));
    await assert.rejects(data.setMemberRole(editor.id, board.id, newcomer.id, "editor"));
    await assert.rejects(data.setLinkAccess(editor.id, board.id, "edit"));
    await assert.rejects(data.setMemberRole(owner.id, board.id, owner.id, "viewer"));
    await assert.rejects(data.listPeople(stranger.id, board.id));
    await data.setMemberRole(owner.id, board.id, editor.id, "viewer");
    assert.equal(await data.getRole(board.id, editor.id), "viewer");
    await data.setMemberRole(owner.id, board.id, editor.id, null);
    assert.equal(await data.getRole(board.id, editor.id), null);

    // Pending invites can be withdrawn.
    const nobody = `nobody-${uniq()}@example.com`;
    await data.shareBoard(owner.id, board.id, nobody, "viewer");
    await data.cancelInvite(owner.id, board.id, nobody);
    assert.ok(!(await data.listPeople(owner.id, board.id)).some((p) => p.email === nobody));

    // Link access: off by default, then anyone signed in with the link (id and secret) joins with the link's role.
    await assert.rejects(data.getLinkSecret(stranger.id, board.id), "only people on the board read the secret");
    const secret = await data.getLinkSecret(owner.id, board.id);
    assert.match(secret, /^[0-9a-f]{32}$/);
    assert.equal(await data.getLinkSecret(newcomer.id, board.id), secret, "anyone on the board can copy the link");
    assert.equal(await data.joinViaLink(stranger.id, board.id, { secret }), null);
    await data.setLinkAccess(owner.id, board.id, "comment");
    // The board id alone, or a wrong secret, is never enough.
    assert.equal(await data.joinViaLink(stranger.id, board.id, { secret: "" }), null);
    assert.equal(await data.joinViaLink(stranger.id, board.id, { secret: "0".repeat(32) }), null);
    assert.equal(await data.joinViaLink(stranger.id, board.id, { secret: secret.toUpperCase() }), null);
    assert.equal(await data.getRole(board.id, stranger.id), null);
    assert.equal(await data.joinViaLink(stranger.id, board.id, { secret }), "commenter");
    assert.equal(await data.getRole(board.id, stranger.id), "commenter");
    assert.equal(await data.joinViaLink(owner.id, board.id, { secret: "" }), "owner");
    assert.ok((await data.listBoards(stranger.id)).some((b) => b.id === board.id));

    // A new secret stops the old link; only owners and co-owners make one.
    await assert.rejects(data.resetLinkSecret(stranger.id, board.id));
    const fresh = await data.resetLinkSecret(owner.id, board.id);
    assert.notEqual(fresh, secret);
    const late = await data.upsertUserByEmail(`late-${uniq()}@example.com`, "Поздний");
    assert.equal(await data.joinViaLink(late.id, board.id, { secret }), null);
    assert.equal(await data.joinViaLink(late.id, board.id, { secret: fresh }), "commenter");
  });
}

for (const [name, load] of layers) {
  test(`${name}: guests (not signed in) view by link only with the secret, and get nothing else`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`go-${uniq()}@example.com`, "Гоша");
    const board = await data.createBoard(owner.id, "Публичная");
    const other = await data.createBoard(owner.id, "Другая");
    const secret = await data.getLinkSecret(owner.id, board.id);
    const otherSecret = await data.getLinkSecret(owner.id, other.id);
    const meta = { boardId: board.id, storagePath: `${board.id}/g.png`, mime: "image/png" as const, bytes: 10, width: 4, height: 3 };
    const img = await data.createAsset(owner.id, meta);
    const otherImg = await data.createAsset(owner.id, { ...meta, boardId: other.id, storagePath: `${other.id}/g.png` });

    // Off by default, and the guest switch alone does nothing while the link itself is private.
    assert.equal((await data.getBoard(board.id))?.guestView, false);
    assert.equal(await data.guestBoard(board.id, secret), null);
    await data.setGuestView(owner.id, board.id, true);
    assert.equal(await data.guestBoard(board.id, secret), null);
    assert.equal(await data.getGuestAsset(img.id, secret), null);

    const viewer = await data.upsertUserByEmail(`gv-${uniq()}@example.com`, "Вика");
    await data.shareBoard(owner.id, board.id, viewer.email, "viewer");
    await assert.rejects(data.setGuestView(viewer.id, board.id, false), "only owners and co-owners switch guests");

    await data.setLinkAccess(owner.id, board.id, "view");
    assert.deepEqual(await data.guestBoard(board.id, secret), { id: board.id, name: "Публичная" });
    assert.equal((await data.getBoard(board.id))?.guestView, true);

    // Without the secret, with a wrong one, or with another board's: nothing.
    for (const bad of ["", "x", "0".repeat(32), secret.slice(0, 31), `${secret}0`, secret.toUpperCase(), otherSecret, `' or '1'='1`]) {
      assert.equal(await data.guestBoard(board.id, bad), null, `guestBoard with ${JSON.stringify(bad)}`);
      assert.equal(await data.getGuestAsset(img.id, bad), null, `getGuestAsset with ${JSON.stringify(bad)}`);
    }
    assert.equal(await data.guestBoard(other.id, secret), null, "a secret opens only its own board");

    // Images: only the ones on the board whose secret the guest holds.
    assert.equal((await data.getGuestAsset(img.id, secret))?.storagePath, meta.storagePath);
    assert.equal(await data.getGuestAsset(otherImg.id, secret), null);
    assert.equal(await data.getGuestAsset(otherImg.id, otherSecret), null, "the other board has no guest link");

    // A new secret, guests off, link closed, or the board in the trash: the old link stops at once.
    const fresh = await data.resetLinkSecret(owner.id, board.id);
    assert.equal(await data.guestBoard(board.id, secret), null);
    assert.equal(await data.getGuestAsset(img.id, secret), null);
    assert.ok(await data.guestBoard(board.id, fresh));
    await data.setGuestView(owner.id, board.id, false);
    assert.equal(await data.guestBoard(board.id, fresh), null);
    await data.setGuestView(owner.id, board.id, true);
    await data.setLinkAccess(owner.id, board.id, "private");
    assert.equal(await data.guestBoard(board.id, fresh), null);
    await data.setLinkAccess(owner.id, board.id, "edit");
    assert.ok(await data.guestBoard(board.id, fresh));
    await data.trashBoard(owner.id, board.id);
    assert.equal(await data.guestBoard(board.id, fresh), null);
    assert.equal(await data.getGuestAsset(img.id, fresh), null);
  });
}

if (process.env.TEST_DATABASE_URL) {
  test("postgres: the anon role (guests) reads no table and writes nothing, even on a guest-link board", async () => {
    const data = (await import("./postgres")).postgresData;
    const owner = await data.upsertUserByEmail(`an-${uniq()}@example.com`, "Аня");
    const board = await data.createBoard(owner.id, "Открытая");
    await data.setLinkAccess(owner.id, board.id, "comment");
    await data.setGuestView(owner.id, board.id, true);
    const secret = await data.getLinkSecret(owner.id, board.id);
    await data.createAsset(owner.id, { boardId: board.id, storagePath: `${board.id}/a.png`, mime: "image/png", bytes: 1, width: 1, height: 1 });
    await data.createThread(owner.id, board.id, { x: 0, y: 0 }, "Привет");

    const asAnon = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
      raw().begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "anon" })}, true)`;
        await tx.unsafe("set local role anon");
        return fn(tx);
      }) as Promise<T>;
    const nothing = async (q: (tx: postgres.TransactionSql) => PromiseLike<readonly unknown[]>) => {
      // Either no rows (row level security) or no privilege at all: both mean nothing leaks.
      const rows: readonly unknown[] = await asAnon(async (tx) => await q(tx)).catch(() => []);
      assert.equal(rows.length, 0);
    };
    await nothing((tx) => tx`select * from boards where id = ${board.id}`);
    await nothing((tx) => tx`select link_token from boards`);
    await nothing((tx) => tx`select * from board_members where board_id = ${board.id}`);
    await nothing((tx) => tx`select * from profiles`);
    await nothing((tx) => tx`select * from board_docs`);
    await nothing((tx) => tx`select * from assets`);
    await nothing((tx) => tx`select * from comment_threads`);
    await nothing((tx) => tx`select * from comments`);
    await nothing((tx) => tx`select * from board_invites`);
    // The people list and comments need a signed-in caller on the board.
    await assert.rejects(asAnon((tx) => tx`select * from board_people(${board.id})`));
    await assert.rejects(asAnon((tx) => tx`select * from board_comments(${board.id})`));
    // Guests cannot comment, join, or change anything, secret or not.
    await assert.rejects(asAnon((tx) => tx`insert into comment_threads (board_id, x, y, created_by) values (${board.id}, 0, 0, ${owner.id})`));
    await assert.rejects(asAnon((tx) => tx`select join_board_via_link(${board.id}, ${secret}, null::text)`));
    const upd = await asAnon((tx) => tx`update boards set name = 'взлом' where id = ${board.id}`).catch(() => ({ count: 0 }));
    assert.equal(upd.count, 0);
    // The old forms that took the board id alone are gone.
    await assert.rejects(raw()`select join_board_via_link(${board.id}::uuid)`);
    await assert.rejects(raw()`select join_board_via_link(${board.id}::uuid, null::text)`);
    // What a guest may call: the board's id and name for the right secret, nothing for any other.
    assert.deepEqual([...(await asAnon((tx) => tx`select * from guest_board(${board.id}, ${secret})`))], [{ id: board.id, name: "Открытая" }]);
    assert.equal((await asAnon((tx) => tx`select * from guest_board(${board.id}, ${"0".repeat(32)})`)).length, 0);
    assert.equal((await asAnon((tx) => tx`select * from guest_board(${board.id}, null)`)).length, 0);
    assert.equal((await data.getBoard(board.id))?.name, "Открытая");
  });
}

for (const [name, load] of layers) {
  test(`${name}: comments, replies, resolve, mentions, and who may write`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`co-${uniq()}@example.com`, "Ольга");
    const commenter = await data.upsertUserByEmail(`cc-${uniq()}@example.com`, "Костя");
    const viewer = await data.upsertUserByEmail(`cv-${uniq()}@example.com`, "Вера");
    const outsider = await data.upsertUserByEmail(`cx-${uniq()}@example.com`, "Хаким");
    const board = await data.createBoard(owner.id, "Обсуждение");
    await data.shareBoard(owner.id, board.id, commenter.email, "commenter");
    await data.shareBoard(owner.id, board.id, viewer.email, "viewer");

    const thread = await data.createThread(owner.id, board.id, { x: 10, y: 20, itemId: "sticky1" }, "  @Костя посмотри  ", [commenter.id, outsider.id, owner.id]);
    assert.equal(thread.comments[0].body, "@Костя посмотри");
    assert.equal(thread.comments[0].authorName, "Ольга");
    // Only people on the board are notified, and never the author
    assert.equal(await data.unreadMentions(commenter.id), 1);
    assert.equal(await data.unreadMentions(outsider.id), 0);
    assert.equal(await data.unreadMentions(owner.id), 0);

    await data.replyToThread(commenter.id, thread.id, "Готово");
    await data.setThreadResolved(commenter.id, thread.id, true);
    const [read] = await data.listThreads(viewer.id, board.id);
    assert.equal(read.itemId, "sticky1");
    assert.equal(read.resolved, true);
    assert.deepEqual(read.comments.map((c) => [c.authorName, c.body]), [["Ольга", "@Костя посмотри"], ["Костя", "Готово"]]);

    // Viewers read but do not write; outsiders see nothing
    await assert.rejects(data.createThread(viewer.id, board.id, { x: 0, y: 0 }, "нельзя"));
    await assert.rejects(data.replyToThread(viewer.id, thread.id, "нельзя"));
    await assert.rejects(data.setThreadResolved(viewer.id, thread.id, false));
    await assert.rejects(data.listThreads(outsider.id, board.id));
    await assert.rejects(data.replyToThread(outsider.id, thread.id, "нельзя"));
    await assert.rejects(data.createThread(owner.id, board.id, { x: 0, y: 0 }, "   "));
  });
}

for (const [name, load] of layers) {
  test(`${name}: images: editors upload, viewers fetch, outsiders get nothing`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`io-${uniq()}@example.com`, "Ирина");
    const viewer = await data.upsertUserByEmail(`iv-${uniq()}@example.com`, "Влад");
    const outsider = await data.upsertUserByEmail(`ix-${uniq()}@example.com`, "Хаким");
    const board = await data.createBoard(owner.id, "Картинки");
    await data.shareBoard(owner.id, board.id, viewer.email, "viewer");
    const meta = { boardId: board.id, storagePath: `${board.id}/x.png`, mime: "image/png" as const, bytes: 10, width: 4, height: 3 };

    const a = await data.createAsset(owner.id, meta);
    assert.equal((await data.getAsset(viewer.id, a.id))?.storagePath, meta.storagePath);
    assert.equal(await data.getAsset(outsider.id, a.id), null);
    await assert.rejects(data.createAsset(viewer.id, { ...meta, storagePath: `${board.id}/y.png` }));
    await assert.rejects(data.createAsset(outsider.id, { ...meta, storagePath: `${board.id}/z.png` }));
    await data.trashBoard(owner.id, board.id);
    assert.equal(await data.getAsset(owner.id, a.id), null);
  });
}

// ---------- duplicate, trash purge, notifications ----------

// Board content is written by the realtime server, not the data layer; tests write and read it the same way it does.
async function seedDoc(layer: string, boardId: string, state: Uint8Array) {
  if (layer === "local") {
    await fs.mkdir(path.join(process.env.DATA_DIR!, "docs"), { recursive: true });
    await fs.writeFile(path.join(process.env.DATA_DIR!, "docs", `${boardId}.bin`), state);
  } else {
    await raw()`insert into board_docs (board_id, state) values (${boardId}, ${Buffer.from(state)}) on conflict (board_id) do update set state = excluded.state`;
  }
}

async function readDoc(layer: string, boardId: string): Promise<Uint8Array | null> {
  if (layer === "local") {
    try {
      return new Uint8Array(await fs.readFile(path.join(process.env.DATA_DIR!, "docs", `${boardId}.bin`)));
    } catch {
      return null;
    }
  }
  const [row] = await raw()<{ state: Buffer }[]>`select state from board_docs where board_id = ${boardId}`;
  return row ? new Uint8Array(row.state) : null;
}

let rawClient: postgres.Sql | null = null;
function raw() {
  rawClient ??= postgres(process.env.TEST_DATABASE_URL!, { max: 2, onnotice: () => {} });
  return rawClient;
}
after(async () => {
  await rawClient?.end();
});

const DAY = 86_400_000;

for (const [name, load] of layers) {
  test(`${name}: duplicate copies content and images for the person who copies`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`do-${uniq()}@example.com`, "Дина");
    const editor = await data.upsertUserByEmail(`de-${uniq()}@example.com`, "Эдик");
    const viewer = await data.upsertUserByEmail(`dv-${uniq()}@example.com`, "Ваня");
    const outsider = await data.upsertUserByEmail(`dx-${uniq()}@example.com`, "Хаким");
    const board = await data.createBoard(owner.id, "Исходная");
    await data.shareBoard(owner.id, board.id, editor.email, "editor");
    await data.shareBoard(owner.id, board.id, viewer.email, "viewer");
    const asset = await data.createAsset(owner.id, { boardId: board.id, storagePath: `${board.id}/${randomUUID()}.png`, mime: "image/png", bytes: 10, width: 4, height: 3 });

    const doc = new Y.Doc();
    const sticky = addSticky(doc, { x: 0, y: 0 }, owner.id, { text: "Идея" });
    const image = addItem<ImageItem>(doc, { type: "image", x: 300, y: 0, w: 4, h: 3, assetId: asset.id, src: `/api/assets/${asset.id}`, alt: "x.png" }, owner.id);
    await seedDoc(name, board.id, Y.encodeStateAsUpdate(doc));

    // Viewers and outsiders cannot copy
    await assert.rejects(data.duplicateBoard(viewer.id, board.id, "Копия"));
    await assert.rejects(data.duplicateBoard(outsider.id, board.id, "Копия"));

    const copy = await data.duplicateBoard(editor.id, board.id, "Исходная (копия)");
    assert.equal(copy.name, "Исходная (копия)");
    assert.equal(copy.ownerId, editor.id);
    assert.equal(copy.linkAccess, "private");
    assert.equal(await data.getRole(copy.id, editor.id), "owner");
    // The copy is private to whoever made it
    assert.equal(await data.getRole(copy.id, owner.id), null);
    assert.ok((await data.listBoards(editor.id)).some((b) => b.id === copy.id));

    const copied = new Y.Doc();
    Y.applyUpdate(copied, (await readDoc(name, copy.id))!);
    const items = readAll(copied);
    assert.equal(items.find((i) => i.id === sticky.id && i.type === "sticky")?.type, "sticky");
    const img = items.find((i) => i.id === image.id) as ImageItem;
    assert.notEqual(img.assetId, asset.id);
    assert.equal(img.src, `/api/assets/${img.assetId}`);
    const copiedAsset = await data.getAsset(editor.id, img.assetId);
    assert.equal(copiedAsset?.boardId, copy.id);
    assert.equal(copiedAsset?.storagePath, asset.storagePath);
    assert.equal(await data.getAsset(owner.id, img.assetId), null);

    // A board that was never opened copies as an empty board
    const blank = await data.createBoard(owner.id, "Пустая");
    const blankCopy = await data.duplicateBoard(owner.id, blank.id, "Пустая (копия)");
    const empty = new Y.Doc();
    Y.applyUpdate(empty, (await readDoc(name, blankCopy.id))!);
    assert.equal(readAll(empty).length, 0);

    // Images of the copy survive the original being purged; the shared file is not reported as orphaned
    await data.trashBoard(owner.id, board.id);
    const purged = await data.purgeTrash(new Date(Date.now() + 31 * DAY));
    assert.ok(purged.boards >= 1);
    assert.ok(!purged.orphanedFiles.includes(asset.storagePath));
    assert.equal(await data.getBoard(board.id), null);
    assert.equal((await data.getAsset(editor.id, img.assetId))?.storagePath, asset.storagePath);
    // Once the copy goes too, the file is orphaned
    await data.trashBoard(editor.id, copy.id);
    const again = await data.purgeTrash(new Date(Date.now() + 31 * DAY));
    assert.ok(again.orphanedFiles.includes(asset.storagePath));
  });
}

for (const [name, load] of layers) {
  test(`${name}: trash purge deletes boards after 30 days only`, async () => {
    const data = await load();
    const owner = await data.upsertUserByEmail(`p-${uniq()}@example.com`, "Пётр");
    const old = await data.createBoard(owner.id, "Старая");
    const recent = await data.createBoard(owner.id, "Свежая");
    const live = await data.createBoard(owner.id, "Живая");
    await data.trashBoard(owner.id, old.id);
    await data.trashBoard(owner.id, recent.id);
    await data.createThread(owner.id, live.id, { x: 0, y: 0 }, "остаётся");

    // Nothing is older than 30 days yet
    await data.purgeTrash(new Date());
    assert.equal((await data.listBoards(owner.id, { trashed: true })).length, 2);

    // 29 days on, still kept
    const trashedAt = Date.parse((await data.getBoard(old.id))!.deletedAt!);
    await data.purgeTrash(new Date(trashedAt + 29 * DAY));
    assert.equal((await data.listBoards(owner.id, { trashed: true })).length, 2);

    // 31 days on, both trashed boards are gone for good; the live one is untouched
    await data.purgeTrash(new Date(trashedAt + 31 * DAY));
    assert.deepEqual(await data.listBoards(owner.id, { trashed: true }), []);
    assert.equal(await data.getBoard(old.id), null);
    assert.equal(await data.getBoard(recent.id), null);
    await assert.rejects(data.restoreBoard(owner.id, old.id));
    assert.equal(await data.getRole(live.id, owner.id), "owner");
    assert.equal((await data.listThreads(owner.id, live.id)).length, 1);
  });
}

test("days left before purge", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(daysUntilPurge(new Date(now).toISOString(), now), 30);
  assert.equal(daysUntilPurge(new Date(now - 1 * DAY).toISOString(), now), 29);
  assert.equal(daysUntilPurge(new Date(now - 29.5 * DAY).toISOString(), now), 1);
  assert.equal(daysUntilPurge(new Date(now - 40 * DAY).toISOString(), now), 0);
});

for (const [name, load] of layers) {
  test(`${name}: notifications for mentions and invites, private to their owner`, async () => {
    const data = await load();
    const a = await data.upsertUserByEmail(`na-${uniq()}@example.com`, "Аня");
    const b = await data.upsertUserByEmail(`nb-${uniq()}@example.com`, "Боря");
    const board = await data.createBoard(a.id, "Планёрка");

    // Adding an existing account notifies them; changing their role later does not notify again
    await data.shareBoard(a.id, board.id, b.email, "editor");
    await data.shareBoard(a.id, board.id, b.email, "commenter");
    let mine = await data.listNotifications(b.id);
    assert.deepEqual(mine.map((n) => [n.kind, n.boardName, n.actorName, n.read]), [["invite", "Планёрка", "Аня", false]]);

    // An invite for an address without an account turns into a notification on sign-up
    const later = `nl-${uniq()}@example.com`;
    await data.shareBoard(a.id, board.id, later, "viewer");
    const newcomer = await data.upsertUserByEmail(later, "Лена");
    assert.deepEqual((await data.listNotifications(newcomer.id)).map((n) => [n.kind, n.boardId, n.actorName]), [["invite", board.id, "Аня"]]);

    // B mentions A; A sees the comment text, B does not get a notification for their own comment
    await data.createThread(b.id, board.id, { x: 0, y: 0 }, "@Аня глянь", [a.id, b.id]);
    const forA = await data.listNotifications(a.id);
    assert.deepEqual(forA.map((n) => [n.kind, n.actorName, n.excerpt]), [["mention", "Боря", "@Аня глянь"]]);
    assert.equal(await data.unreadNotifications(a.id), 1);
    assert.equal(await data.unreadNotifications(b.id), 1);

    // B cannot read or mark A's notifications
    mine = await data.listNotifications(b.id);
    assert.ok(!mine.some((n) => n.id === forA[0].id));
    await data.markNotificationsRead(b.id, [forA[0].id]);
    assert.equal(await data.unreadNotifications(a.id), 1);
    await data.markNotificationsRead(b.id);
    assert.equal(await data.unreadNotifications(a.id), 1);
    assert.equal(await data.unreadNotifications(b.id), 0);

    // Marking one read, then all
    await new Promise((r) => setTimeout(r, 5)); // distinct timestamps, so "newest first" is well defined
    await data.createThread(b.id, board.id, { x: 5, y: 5 }, "@Аня ещё", [a.id]);
    const two = await data.listNotifications(a.id);
    assert.equal(two.length, 2);
    assert.equal(two[0].excerpt, "@Аня ещё");
    await data.markNotificationsRead(a.id, [two[0].id]);
    assert.deepEqual((await data.listNotifications(a.id)).map((n) => n.read), [true, false]);
    await data.markNotificationsRead(a.id);
    assert.equal(await data.unreadNotifications(a.id), 0);

    // Losing access to the board hides its notifications
    await data.setMemberRole(a.id, board.id, b.id, null);
    assert.deepEqual(await data.listNotifications(b.id), []);
  });
}

if (process.env.TEST_DATABASE_URL) {
  test("postgres: row level security keeps notifications private at the table", async () => {
    const data = (await import("./postgres")).postgresData;
    const a = await data.upsertUserByEmail(`ra-${uniq()}@example.com`, "Ада");
    const b = await data.upsertUserByEmail(`rb-${uniq()}@example.com`, "Бен");
    const board = await data.createBoard(b.id, "Секрет");
    await data.shareBoard(b.id, board.id, a.email, "editor");
    const [own] = await data.listNotifications(a.id);
    assert.ok(own);

    const asB = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
      raw().begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: b.id, role: "authenticated" })}, true)`;
        await tx.unsafe("set local role authenticated");
        return fn(tx);
      }) as Promise<T>;

    assert.equal((await asB((tx) => tx`select id from notifications where user_id = ${a.id}`)).length, 0);
    assert.equal((await asB((tx) => tx`select id from notifications where id = ${own.id}`)).length, 0);
    assert.equal((await asB((tx) => tx`update notifications set read_at = now() where id = ${own.id}`)).count, 0);
    assert.equal((await asB((tx) => tx`delete from notifications where id = ${own.id}`)).count, 0);
    await assert.rejects(asB((tx) => tx`insert into notifications (user_id, kind, board_id) values (${a.id}, 'mention', ${board.id})`));
    assert.equal((await asB((tx) => tx`select * from my_notifications(200) where id = ${own.id}`)).length, 0);
    // Board content stays with the realtime server: users cannot read board_docs or seed someone else's board
    assert.equal((await asB((tx) => tx`select board_id from board_docs`)).length, 0);
    const other = await data.createBoard(a.id, "Чужая");
    await assert.rejects(asB((tx) => tx`select seed_board_doc(${other.id}, ${Buffer.from([0, 0])})`));
    await assert.rejects(asB((tx) => tx`select board_doc_state(${other.id})`));
    assert.equal((await data.listNotifications(a.id)).find((n) => n.id === own.id)?.read, false);
  });
}
