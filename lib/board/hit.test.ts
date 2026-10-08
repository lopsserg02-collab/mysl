import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectorItem, DrawingItem, FrameItem, Item, StickyItem } from "./model";
import { hitTest } from "./hit";

const base = { z: 0, createdBy: "u", updatedAt: 0 };
const frame: FrameItem = { ...base, id: "f", type: "frame", x: 0, y: 0, w: 1000, h: 1000, title: "" };
const a: StickyItem = { ...base, id: "a", type: "sticky", x: 100, y: 100, w: 200, h: 200, color: "lemon", text: "" };
const b: StickyItem = { ...base, id: "b", type: "sticky", x: 250, y: 250, w: 200, h: 200, color: "lemon", text: "" };
const line: ConnectorItem = { ...base, id: "c", type: "connector", x: 0, y: 0, w: 0, h: 0, from: { itemId: "a", x: 0, y: 0 }, to: { x: 800, y: 200 }, route: "straight", endArrow: true, startArrow: false, stroke: "#000", label: "" };
const pen: DrawingItem = { ...base, id: "d", type: "drawing", x: 600, y: 600, w: 100, h: 1, points: [0, 0, 100, 0], stroke: "#000", width: 4, highlighter: false };
const items: Item[] = [frame, a, b, line, pen];
const boxes = new Map(items.map((i) => [i.id, i]));
const lookup = (id: string) => boxes.get(id);

test("hit test: topmost item first, lines and strokes within a few pixels, frames by title or inside", () => {
  assert.deepEqual(hitTest(items, { x: 270, y: 270 }, 1, lookup), { id: "b", title: false }); // b is above a
  assert.deepEqual(hitTest(items, { x: 120, y: 120 }, 1, lookup), { id: "a", title: false });
  assert.deepEqual(hitTest(items, { x: 600, y: 203 }, 1, lookup), { id: "c", title: false }); // near the line from a's right side
  assert.deepEqual(hitTest(items, { x: 650, y: 604 }, 1, lookup), { id: "d", title: false });
  assert.deepEqual(hitTest(items, { x: 650, y: 640 }, 1, lookup), { id: "f", title: false }); // empty inside of the frame
  assert.deepEqual(hitTest(items, { x: 50, y: -10 }, 1, lookup), { id: "f", title: true });
  assert.deepEqual(hitTest(items, { x: 2000, y: 2000 }, 1, lookup), { id: null, title: false });
  // Far out, the slack grows in board units: 6 screen pixels at 10% is 60 units.
  assert.deepEqual(hitTest(items, { x: 650, y: 650 }, 0.1, lookup), { id: "d", title: false });
});
