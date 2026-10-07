import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { addItem, addSticky, readAll, type ImageItem } from "./model";
import { cloneBoardState, imageAssetIds } from "./clone";

test("clone keeps every item and re-points images at the copy's assets", () => {
  const doc = new Y.Doc();
  addSticky(doc, { x: 0, y: 0 }, "u1", { text: "a" });
  addItem<ImageItem>(doc, { type: "image", x: 0, y: 0, w: 1, h: 1, assetId: "old", src: "/api/assets/old", alt: "" }, "u1");
  addItem<ImageItem>(doc, { type: "image", x: 0, y: 0, w: 1, h: 1, assetId: "elsewhere", src: "/api/assets/elsewhere", alt: "" }, "u1");
  const out = cloneBoardState(Y.encodeStateAsUpdate(doc), new Map([["old", "new"]]));
  const copy = new Y.Doc();
  Y.applyUpdate(copy, out);
  assert.equal(readAll(copy).length, 3);
  assert.deepEqual(imageAssetIds(out).sort(), ["elsewhere", "new"]);
  assert.ok(readAll(copy).some((i) => i.type === "image" && i.src === "/api/assets/new"));
  // The source is untouched
  assert.deepEqual(imageAssetIds(Y.encodeStateAsUpdate(doc)).sort(), ["elsewhere", "old"]);
});

test("cloning nothing gives an empty board", () => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, cloneBoardState(null));
  assert.equal(readAll(copy).length, 0);
});
