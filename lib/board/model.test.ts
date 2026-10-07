import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { type StickyItem, addSticky, deleteItems, duplicateItems, readAll, updateItems, bringToFront, sendToBack } from "./model";
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
  const [item] = readAll(a) as StickyItem[];
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

import { addItem, anchorOn, connectorPoints, itemsInside, simplify, type ConnectorItem, type FrameItem, type ShapeItem } from "./model";

test("deleting an item removes the connectors attached to it", () => {
  const d = new Y.Doc();
  const a = addSticky(d, { x: 0, y: 0 }, "u");
  const b = addSticky(d, { x: 400, y: 0 }, "u");
  const c = addItem<ConnectorItem>(d, { type: "connector", x: 0, y: 0, w: 0, h: 0, from: { itemId: a.id, x: 0, y: 0 }, to: { itemId: b.id, x: 0, y: 0 }, route: "straight", endArrow: true, startArrow: false, stroke: "#000", label: "" }, "u");
  deleteItems(d, [a.id]);
  assert.deepEqual(readAll(d).map((i) => i.id), [b.id]);
  assert.ok(!readAll(d).some((i) => i.id === c.id));
});

test("duplicating two connected items re-points the connector copy", () => {
  const d = new Y.Doc();
  const a = addSticky(d, { x: 0, y: 0 }, "u");
  const b = addSticky(d, { x: 400, y: 0 }, "u");
  const c = addItem<ConnectorItem>(d, { type: "connector", x: 0, y: 0, w: 0, h: 0, from: { itemId: a.id, x: 0, y: 0 }, to: { itemId: b.id, x: 0, y: 0 }, route: "straight", endArrow: true, startArrow: false, stroke: "#000", label: "" }, "u");
  const copies = duplicateItems(d, [a.id, b.id, c.id], "u");
  const copy = readAll(d).find((i) => i.id === copies[2]) as ConnectorItem;
  assert.equal(copy.from.itemId, copies[0]);
  assert.equal(copy.to.itemId, copies[1]);
});

test("connector follows attached items and snaps to facing sides", () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 300, y: 0, w: 100, h: 100 };
  assert.deepEqual(anchorOn(a, { x: 350, y: 50 }), { x: 100, y: 50, side: "right" });
  const c = { type: "connector", from: { itemId: "a", x: 0, y: 0 }, to: { itemId: "b", x: 0, y: 0 }, route: "straight" } as ConnectorItem;
  const boxes: Record<string, typeof a> = { a, b };
  assert.deepEqual(connectorPoints(c, (id) => boxes[id]), [100, 50, 300, 50]);
  boxes.b = { x: 0, y: 300, w: 100, h: 100 };
  assert.deepEqual(connectorPoints(c, (id) => boxes[id]), [50, 100, 50, 300]);
  assert.equal(connectorPoints({ ...c, route: "elbow" }, (id) => boxes[id]).length, 8);
});

test("simplify keeps the ends and drops collinear points", () => {
  const line = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 4, 4];
  assert.deepEqual(simplify(line), [0, 0, 4, 0, 4, 4]);
});

test("frames, shapes: items fully inside a frame move with it; frames render first", () => {
  const d = new Y.Doc();
  const s = addItem<ShapeItem>(d, { type: "shape", kind: "rect", x: 20, y: 20, w: 50, h: 50, text: "", fill: "none", stroke: "#000" }, "u");
  const f = addItem<FrameItem>(d, { type: "frame", x: 0, y: 0, w: 300, h: 300, title: "" }, "u");
  addSticky(d, { x: 290, y: 290 }, "u"); // sticks out of the frame
  assert.equal(readAll(d)[0].id, f.id);
  assert.deepEqual(itemsInside(f, readAll(d), f.id), [s.id]);
});
