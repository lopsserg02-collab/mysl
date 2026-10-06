import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { addSticky, deleteItems, duplicateItems, readAll, updateItems, bringToFront, sendToBack } from "./model";
import { fitFontSize, wrap } from "./fit";

test("two replicas converge after concurrent edits", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const s = addSticky(a, { x: 0, y: 0 }, "u1");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  updateItems(a, [{ id: s.id, patch: { color: "mint" } }]);
  updateItems(b, [{ id: s.id, patch: { text: "hello" } }]);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.deepEqual(readAll(a), readAll(b));
  const [item] = readAll(a);
  assert.equal(item.color, "mint");
  assert.equal(item.text, "hello");
});

test("sticky is centred on the click point", () => {
  const d = new Y.Doc();
  const s = addSticky(d, { x: 500, y: 300 }, "u1");
  assert.equal(s.x + s.w / 2, 500);
  assert.equal(s.y + s.h / 2, 300);
});

test("duplicate, layer order and delete", () => {
  const d = new Y.Doc();
  const a = addSticky(d, { x: 0, y: 0 }, "u1");
  const b = addSticky(d, { x: 10, y: 10 }, "u1");
  const [c] = duplicateItems(d, [a.id], "u2");
  assert.equal(readAll(d).length, 3);
  assert.equal(readAll(d).at(-1)!.id, c);
  sendToBack(d, [b.id]);
  assert.equal(readAll(d)[0].id, b.id);
  bringToFront(d, [b.id]);
  assert.equal(readAll(d).at(-1)!.id, b.id);
  deleteItems(d, [a.id, c]);
  assert.deepEqual(readAll(d).map((i) => i.id), [b.id]);
});

test("undo only reverts the local user's changes", () => {
  const d = new Y.Doc();
  const mine = { local: true };
  const undo = new Y.UndoManager(d.getMap("items"), { trackedOrigins: new Set([mine]) });
  d.transact(() => addSticky(d, { x: 0, y: 0 }, "me"), mine);
  addSticky(d, { x: 0, y: 0 }, "someone-else"); // remote-style change, untracked origin
  undo.undo();
  assert.deepEqual(readAll(d).map((i) => i.createdBy), ["someone-else"]);
});

const mono: (t: string, s: number) => number = (t, s) => t.length * s * 0.6;

test("text shrinks to fit and never overflows", () => {
  const short = fitFontSize("Hi", { width: 170, height: 170 }, mono);
  const long = fitFontSize("A much longer note with many words that has to wrap over several lines", { width: 170, height: 170 }, mono);
  assert.ok(short > long);
  const lines = wrap("A much longer note with many words that has to wrap over several lines", long, 170, mono);
  assert.ok(lines.length * long * 1.3 <= 170);
});
