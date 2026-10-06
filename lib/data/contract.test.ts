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
