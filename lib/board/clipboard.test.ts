import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { addItem, addSticky, groupItems, readAll, type ConnectorItem, type ImageItem, type StickyItem } from "./model";
import { copyPayload, parsePayload, pasteItems, plainText } from "./clipboard";

const link = (from: string, to: string) =>
  ({ type: "connector", x: 0, y: 0, w: 0, h: 0, from: { itemId: from, x: 0, y: 0 }, to: { itemId: to, x: 0, y: 0 }, route: "elbow", endArrow: true, startArrow: false, stroke: "#000", label: "связь" }) as const;

test("copy two connected items: the connector comes along and attaches to the pasted copies on another board", () => {
  const src = new Y.Doc();
  const a = addSticky(src, { x: 100, y: 100 }, "u", { text: "А" });
  const b = addSticky(src, { x: 500, y: 100 }, "u", { text: "Б" });
  addItem<ConnectorItem>(src, link(a.id, b.id), "u");
  const payload = copyPayload(readAll(src), [a.id, b.id])!;
  assert.equal(payload.items.length, 3);
  assert.equal(plainText(payload), "А\nБ\nсвязь");

  // Through the clipboard as text, into another board.
  const parsed = parsePayload(JSON.stringify(payload))!;
  const dst = new Y.Doc();
  addSticky(dst, { x: 0, y: 0 }, "v");
  const ids = pasteItems(dst, parsed, { x: 1000, y: 1000 }, "v");
  assert.equal(ids.length, 3);
  const pasted = readAll(dst).filter((i) => ids.includes(i.id));
  const stickies = pasted.filter((i): i is StickyItem => i.type === "sticky");
  const c = pasted.find((i): i is ConnectorItem => i.type === "connector")!;
  assert.deepEqual(new Set([c.from.itemId, c.to.itemId]), new Set(stickies.map((s) => s.id)));
  assert.ok(!ids.includes(a.id) && !ids.includes(b.id));
  // Centred on the paste point, on top of what is there, made by the person who pasted.
  const minX = Math.min(...stickies.map((s) => s.x));
  const maxX = Math.max(...stickies.map((s) => s.x + s.w));
  assert.equal((minX + maxX) / 2, 1000);
  assert.ok(stickies.every((s) => s.createdBy === "v" && s.z > 1));
});

test("a connector to an item left behind keeps its place as a free end", () => {
  const d = new Y.Doc();
  const a = addSticky(d, { x: 100, y: 100 }, "u");
  const b = addSticky(d, { x: 500, y: 100 }, "u");
  const c = addItem<ConnectorItem>(d, link(a.id, b.id), "u");
  const p = copyPayload(readAll(d), [a.id, c.id])!;
  const copy = p.items.find((i): i is ConnectorItem => i.type === "connector")!;
  assert.equal(copy.from.itemId, a.id);
  assert.equal(copy.to.itemId, undefined);
  assert.equal(copy.to.x, 400); // b's left side, where the line ended when it was copied
});

test("copying one member copies the whole group, and the copies form a new group", () => {
  const d = new Y.Doc();
  const a = addSticky(d, { x: 0, y: 0 }, "u");
  const b = addSticky(d, { x: 300, y: 0 }, "u");
  const g = groupItems(d, [a.id, b.id]);
  const ids = pasteItems(d, copyPayload(readAll(d), [a.id])!, { x: 0, y: 500 }, "u");
  assert.equal(ids.length, 2);
  const groups = new Set(readAll(d).filter((i) => ids.includes(i.id)).map((i) => i.groupId));
  assert.equal(groups.size, 1);
  assert.ok(![...groups].includes(g!));
});

test("pasted data is validated: foreign text, bad fields and outside image URLs are rejected", () => {
  assert.equal(parsePayload("hello"), null);
  assert.equal(parsePayload(JSON.stringify({ items: [] })), null);
  const good = { id: "x", type: "sticky", x: 0, y: 0, w: 10, h: 10, z: 1, color: "lemon", text: "ok", extra: "dropped" };
  const bad = { id: "y", type: "sticky", x: "0", y: 0, w: 10, h: 10, z: 1, color: "lemon", text: "no" };
  const img = { id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, z: 1, assetId: "a", src: "https://evil.example/x.png", alt: "" };
  const p = parsePayload(JSON.stringify({ mysl: 1, items: [good, bad, img] }))!;
  assert.equal(p.items.length, 1);
  assert.equal("extra" in p.items[0], false);
  const src = "/api/assets/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10";
  const ok = parsePayload(JSON.stringify({ mysl: 1, items: [{ ...img, src }] }))!;
  assert.equal((ok.items[0] as ImageItem).src, src);
});
