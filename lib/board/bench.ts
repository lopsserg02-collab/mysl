// Synthetic boards for the performance budget (e2e/perf.spec.ts): a grid of mixed items in one transaction.
import type * as Y from "yjs";
import { nanoid } from "nanoid";
import { insertItems, type Item } from "./model";
import { DEFAULT_INK, STICKY_COLOR_NAMES } from "./palette";

/** `n` items on a square grid: mostly stickies, some shapes and text, and connectors between neighbours. */
export function seedGrid(doc: Y.Doc, n: number, userId: string, origin = { x: 0, y: 0 }): string[] {
  const side = Math.ceil(Math.sqrt(n));
  const step = 260;
  const out: Item[] = [];
  const now = Date.now();
  let prev: string | null = null;
  for (let k = 0; out.length < n; k++) {
    const col = k % side;
    const row = Math.floor(k / side);
    const base = { id: nanoid(12), x: origin.x + col * step, y: origin.y + row * step, z: k + 1, createdBy: userId, updatedAt: now };
    const kind = k % 20;
    let item: Item;
    if (kind === 19 && prev) {
      // A connector from the previous item to the one before it in the row.
      item = { ...base, type: "connector", x: 0, y: 0, w: 0, h: 0, from: { itemId: prev, x: 0, y: 0 }, to: { x: base.x + 100, y: base.y + 100 }, route: "straight", endArrow: true, startArrow: false, stroke: DEFAULT_INK, label: "" };
    } else if (kind % 5 === 1) {
      item = { ...base, type: "shape", kind: kind % 2 ? "ellipse" : "rect", w: 200, h: 140, text: `Фигура ${k}`, fill: STICKY_COLOR_NAMES[k % 8], stroke: DEFAULT_INK };
    } else if (kind % 7 === 3) {
      item = { ...base, type: "text", w: 180, h: 26, text: `Заметка номер ${k}`, fontSize: 20, color: DEFAULT_INK };
    } else {
      item = { ...base, type: "sticky", w: 200, h: 200, color: STICKY_COLOR_NAMES[k % STICKY_COLOR_NAMES.length], text: `Мысль ${k}: короткий текст на стикере` };
    }
    if (item.type !== "connector") prev = item.id;
    out.push(item);
  }
  insertItems(doc, out);
  return out.map((i) => i.id);
}
