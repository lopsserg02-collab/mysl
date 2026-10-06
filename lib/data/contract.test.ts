// The same behaviour is required of every data layer. Postgres runs when TEST_DATABASE_URL is set.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import type { DataLayer } from "./types";

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

    // Link access: off by default, then anyone signed in joins with the link's role.
    assert.equal(await data.joinViaLink(stranger.id, board.id), null);
    await data.setLinkAccess(owner.id, board.id, "comment");
    assert.equal(await data.joinViaLink(stranger.id, board.id), "commenter");
    assert.equal(await data.getRole(board.id, stranger.id), "commenter");
    assert.equal(await data.joinViaLink(owner.id, board.id), "owner");
    assert.ok((await data.listBoards(stranger.id)).some((b) => b.id === board.id));
  });
}
