// Board document model. Every board is one Y.Doc; items live in the "items" map keyed by id.
import * as Y from "yjs";
import { nanoid } from "nanoid";
import { DEFAULT_STICKY } from "./palette";

export type ItemType = "sticky";

export interface StickyItem {
  id: string;
  type: "sticky";
  x: number; // top-left, board coordinates
  y: number;
  w: number;
  h: number;
  z: number;
  color: string;
  text: string;
  createdBy: string;
  updatedAt: number;
}

export type Item = StickyItem;

export const STICKY_SIZE = 200;

export function itemsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap("items");
}

export function readItem(m: Y.Map<unknown>): Item {
  return m.toJSON() as Item;
}

export function readAll(doc: Y.Doc): Item[] {
  const out: Item[] = [];
  itemsMap(doc).forEach((m) => out.push(readItem(m)));
  return out.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
}

function topZ(doc: Y.Doc): number {
  let z = 0;
  itemsMap(doc).forEach((m) => {
    z = Math.max(z, (m.get("z") as number) ?? 0);
  });
  return z;
}

function toYMap(item: Item): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(item)) m.set(k, v);
  return m;
}

export function addSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  userId: string,
  opts: { color?: string; text?: string } = {},
): StickyItem {
  const item: StickyItem = {
    id: nanoid(12),
    type: "sticky",
    x: Math.round(at.x - STICKY_SIZE / 2),
    y: Math.round(at.y - STICKY_SIZE / 2),
    w: STICKY_SIZE,
    h: STICKY_SIZE,
    z: topZ(doc) + 1,
    color: opts.color ?? DEFAULT_STICKY,
    text: opts.text ?? "",
    createdBy: userId,
    updatedAt: Date.now(),
  };
  doc.transact(() => itemsMap(doc).set(item.id, toYMap(item)));
  return item;
}

export function updateItems(doc: Y.Doc, changes: { id: string; patch: Partial<Omit<Item, "id" | "type">> }[]) {
  const items = itemsMap(doc);
  doc.transact(() => {
    for (const { id, patch } of changes) {
      const m = items.get(id);
      if (!m) continue;
      for (const [k, v] of Object.entries(patch)) m.set(k, v);
      m.set("updatedAt", Date.now());
    }
  });
}

export function deleteItems(doc: Y.Doc, ids: string[]) {
  const items = itemsMap(doc);
  doc.transact(() => ids.forEach((id) => items.delete(id)));
}

export function duplicateItems(doc: Y.Doc, ids: string[], userId: string, offset = 24): string[] {
  const items = itemsMap(doc);
  let z = topZ(doc);
  const created: string[] = [];
  doc.transact(() => {
    for (const id of ids) {
      const m = items.get(id);
      if (!m) continue;
      const src = readItem(m);
      const copy = { ...src, id: nanoid(12), x: src.x + offset, y: src.y + offset, z: ++z, createdBy: userId, updatedAt: Date.now() };
      items.set(copy.id, toYMap(copy));
      created.push(copy.id);
    }
  });
  return created;
}

export function bringToFront(doc: Y.Doc, ids: string[]) {
  let z = topZ(doc);
  updateItems(doc, ids.map((id) => ({ id, patch: { z: ++z } })));
}

export function sendToBack(doc: Y.Doc, ids: string[]) {
  let z = Infinity;
  itemsMap(doc).forEach((m) => (z = Math.min(z, (m.get("z") as number) ?? 0)));
  if (!Number.isFinite(z)) z = 0;
  updateItems(doc, ids.map((id) => ({ id, patch: { z: --z } })));
}
