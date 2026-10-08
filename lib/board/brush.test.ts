import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_SIZES, parseSizes, stepSize, strokeHits } from "./brush";

test("brush: [ and ] step through the presets and stop at the ends", () => {
  assert.equal(stepSize("pen", 3, 1), 5);
  assert.equal(stepSize("pen", 3, -1), 2);
  assert.equal(stepSize("pen", 4, -1), 3); // a size between presets steps to the neighbour
  assert.equal(stepSize("pen", 12, 1), 12);
  assert.equal(stepSize("pen", 20, 1), 20); // above the presets (from the slider): stays
  assert.equal(stepSize("pen", 1, -1), 1);
  assert.equal(stepSize("eraser", 24, 1), 40);
});

test("brush: saved sizes are checked", () => {
  assert.deepEqual(parseSizes(null), INITIAL_SIZES);
  assert.deepEqual(parseSizes("not json"), INITIAL_SIZES);
  assert.deepEqual(parseSizes(JSON.stringify({ pen: 8, highlighter: 1000, eraser: "big" })), { ...INITIAL_SIZES, pen: 8, highlighter: 64 });
});

test("brush: the eraser hits a stroke within its radius plus half the stroke width", () => {
  const d = { x: 100, y: 100, points: [0, 0, 100, 0], width: 4 };
  assert.ok(strokeHits(d, { x: 150, y: 105 }, 4)); // 5 away, reach 6
  assert.ok(!strokeHits(d, { x: 150, y: 108 }, 4));
  assert.ok(strokeHits(d, { x: 150, y: 140 }, 40));
  assert.ok(!strokeHits(d, { x: 230, y: 100 }, 20)); // past the end
  assert.ok(strokeHits({ x: 0, y: 0, points: [5, 5], width: 2 }, { x: 6, y: 6 }, 1));
});
