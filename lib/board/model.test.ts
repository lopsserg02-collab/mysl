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

import { addItem, anchorOn, connectorPoints, itemsInside, simplify, type Box, type ConnectorItem, type FrameItem, type ShapeItem } from "./model";

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

import { groupItems, ungroupItems, withGroups, nextStyle, lassoHits, pointInPolygon, type TextItem } from "./model";
import { seedGrid } from "./bench";

const conn = (from: string, to: string, route: ConnectorItem["route"] = "straight") =>
  ({ type: "connector", x: 0, y: 0, w: 0, h: 0, from: { itemId: from, x: 0, y: 0 }, to: { itemId: to, x: 0, y: 0 }, route, endArrow: true, startArrow: false, stroke: "#000", label: "" }) as const;

test("text style flags are stored on the item and toggle for the whole selection", () => {
  const d = new Y.Doc();
  const a = addItem<TextItem>(d, { type: "text", x: 0, y: 0, w: 60, h: 26, text: "a", fontSize: 20, color: "#000" }, "u");
  const b = addItem<TextItem>(d, { type: "text", x: 0, y: 40, w: 60, h: 26, text: "b", fontSize: 20, color: "#000", bold: true }, "u");
  assert.equal(nextStyle(readAll(d), "bold"), true); // mixed: turn on for all
  updateItems(d, [a.id, b.id].map((id) => ({ id, patch: { bold: true, italic: true } })));
  assert.equal(nextStyle(readAll(d), "bold"), false);
  updateItems(d, [{ id: a.id, patch: { bold: undefined } }]); // undefined removes the field
  const read = readAll(d).find((i) => i.id === a.id) as TextItem;
  assert.equal("bold" in read, false);
  assert.equal(read.italic, true);
});

test("curved connector is a smooth line that leaves and arrives perpendicular to the attached sides", () => {
  const boxes: Record<string, Box> = { a: { x: 0, y: 0, w: 100, h: 100 }, b: { x: 300, y: 200, w: 100, h: 100 } };
  const c = { ...conn("a", "b", "curved"), id: "c", z: 1, createdBy: "u", updatedAt: 0 } as ConnectorItem;
  const pts = connectorPoints(c, (id) => boxes[id]);
  assert.ok(pts.length > 8);
  assert.deepEqual(pts.slice(0, 2), [100, 50]); // right side of a
  assert.deepEqual(pts.slice(-2), [300, 250]); // left side of b
  // leaves heading right, arrives heading right
  assert.ok(pts[2] > pts[0] && Math.abs(pts[3] - pts[1]) < pts[2] - pts[0]);
  assert.ok(pts.at(-2)! > pts.at(-4)!);
  // free ends work too
  const free = connectorPoints({ ...c, from: { x: 0, y: 0 }, to: { x: 200, y: 50 } }, () => undefined);
  assert.deepEqual([free[0], free[1], free.at(-2), free.at(-1)], [0, 0, 200, 50]);
});

test("groups: picked, duplicated and dissolved as a whole", () => {
  const d = new Y.Doc();
  const a = addSticky(d, { x: 0, y: 0 }, "u");
  const b = addSticky(d, { x: 300, y: 0 }, "u");
  const c = addSticky(d, { x: 600, y: 0 }, "u");
  assert.equal(groupItems(d, [a.id]), null); // one item is not a group
  const g = groupItems(d, [a.id, b.id])!;
  assert.ok(g);
  assert.deepEqual(withGroups(readAll(d), [a.id]).sort(), [a.id, b.id].sort());
  assert.deepEqual(withGroups(readAll(d), [c.id]), [c.id]);
  const copies = duplicateItems(d, [a.id, b.id], "u");
  const copyGroups = new Set(readAll(d).filter((i) => copies.includes(i.id)).map((i) => i.groupId));
  assert.equal(copyGroups.size, 1);
  assert.notEqual([...copyGroups][0], g);
  ungroupItems(d, [b.id]);
  assert.deepEqual(withGroups(readAll(d), [a.id]), [a.id]);
  assert.equal(readAll(d).find((i) => i.id === a.id)!.groupId, undefined);
  // the copies stay grouped, and deleting the group removes every member
  assert.equal(withGroups(readAll(d), [copies[0]]).length, 2);
  deleteItems(d, withGroups(readAll(d), [copies[0]]));
  assert.equal(readAll(d).length, 3);
});

test("lasso picks items whose centre it encloses, frames only when fully enclosed", () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100];
  assert.equal(pointInPolygon({ x: 50, y: 50 }, square), true);
  assert.equal(pointInPolygon({ x: 150, y: 50 }, square), false);
  const d = new Y.Doc();
  const inside = addItem<ShapeItem>(d, { type: "shape", kind: "rect", x: 100, y: 100, w: 100, h: 100, text: "", fill: "none", stroke: "#000" }, "u");
  const outside = addItem<ShapeItem>(d, { type: "shape", kind: "rect", x: 380, y: 100, w: 100, h: 100, text: "", fill: "none", stroke: "#000" }, "u");
  addItem<FrameItem>(d, { type: "frame", x: 50, y: 50, w: 600, h: 600, title: "" }, "u");
  // An L-shaped lasso: its bounding box covers the second shape's centre, the lasso itself does not.
  const lasso = [0, 0, 500, 0, 500, 120, 300, 120, 300, 300, 0, 300];
  assert.deepEqual(lassoHits(readAll(d), lasso), [inside.id]);
  assert.ok(!lassoHits(readAll(d), lasso).includes(outside.id));
  assert.equal(lassoHits(readAll(d), [-10, -10, 700, -10, 700, 700, -10, 700]).length, 3);
});

test("seeding 10,000 items is one transaction", () => {
  const d = new Y.Doc();
  let updates = 0;
  d.on("update", () => updates++);
  assert.equal(seedGrid(d, 10_000, "u").length, 10_000);
  assert.equal(updates, 1);
  assert.equal(readAll(d).length, 10_000);
});

test("frames: reading order until someone reorders, then their order; moves are one undo step and sync", async () => {
  const { addItem, frameOrder, moveFrame, itemsMap } = await import("./model");
  type F = import("./model").FrameItem;
  const d = new Y.Doc();
  const undo = new Y.UndoManager(itemsMap(d));
  const mk = (x: number, y: number, title: string) => {
    undo.stopCapturing();
    return addItem<F>(d, { type: "frame", x, y, w: 100, h: 100, title }, "u1");
  };
  mk(500, 0, "B");
  mk(0, 0, "A");
  mk(0, 400, "C");
  const titles = (doc: Y.Doc) => frameOrder(readAll(doc).filter((i): i is F => i.type === "frame")).map((f) => f.title);
  const byTitle = (s: string) => readAll(d).find((i) => i.type === "frame" && i.title === s)!;
  assert.deepEqual(titles(d), ["A", "B", "C"]);

  undo.stopCapturing();
  moveFrame(d, byTitle("C").id, 0);
  assert.deepEqual(titles(d), ["C", "A", "B"]);
  // Every frame is numbered now: a further move changes only the moved frame.
  const before = new Map(readAll(d).map((i) => [i.id, (i as F).order]));
  undo.stopCapturing();
  moveFrame(d, byTitle("B").id, 1);
  assert.deepEqual(titles(d), ["C", "B", "A"]);
  assert.deepEqual(readAll(d).filter((i) => (i as F).order !== before.get(i.id)).map((i) => i.id), [byTitle("B").id]);
  // A new frame goes to the end; a move out of range clamps.
  mk(-100, -100, "D");
  assert.deepEqual(titles(d), ["C", "B", "A", "D"]);
  undo.stopCapturing();
  moveFrame(d, byTitle("C").id, 99);
  assert.deepEqual(titles(d), ["B", "A", "D", "C"]);

  // Another replica sees the same order.
  const e = new Y.Doc();
  Y.applyUpdate(e, Y.encodeStateAsUpdate(d));
  assert.deepEqual(titles(e), ["B", "A", "D", "C"]);

  undo.stopCapturing();
  undo.undo();
  assert.deepEqual(titles(d), ["C", "B", "A", "D"]);
  undo.undo(); // creating D
  undo.undo();
  assert.deepEqual(titles(d), ["C", "A", "B"]);
});

test("frames: many moves into the same gap keep a strict order", async () => {
  const { addItem, frameOrder, moveFrame } = await import("./model");
  type F = import("./model").FrameItem;
  const d = new Y.Doc();
  for (let k = 0; k < 4; k++) addItem<F>(d, { type: "frame", x: k * 200, y: 0, w: 100, h: 100, title: String(k) }, "u1");
  const list = () => frameOrder(readAll(d).filter((i): i is F => i.type === "frame"));
  for (let n = 0; n < 80; n++) moveFrame(d, list()[3].id, 1);
  const orders = list().map((f) => f.order!);
  assert.equal(new Set(orders).size, orders.length);
  assert.deepEqual([...orders].sort((a, b) => a - b), orders);
});
