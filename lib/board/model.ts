// Board document model. Every board is one Y.Doc; items live in the "items" map keyed by id.
import * as Y from "yjs";
import { nanoid } from "nanoid";
import { DEFAULT_STICKY } from "./palette";

export type ShapeKind = "rect" | "round" | "ellipse" | "triangle" | "diamond";
export type Route = "straight" | "elbow";

interface Base {
  id: string;
  x: number; // top-left, board coordinates
  y: number;
  w: number;
  h: number;
  z: number;
  locked?: boolean;
  createdBy: string;
  updatedAt: number;
}

export interface StickyItem extends Base {
  type: "sticky";
  color: string;
  text: string;
}

export interface TextItem extends Base {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
  fixedWidth?: boolean; // set once someone resizes it; until then it grows with the text
}

export interface ShapeItem extends Base {
  type: "shape";
  kind: ShapeKind;
  text: string;
  fill: string; // sticky palette name, or "none"
  stroke: string; // hex from tokens
}

/** An end of a connector: attached to an item (and follows it) or a free point. */
export interface End {
  itemId?: string;
  x: number; // used when not attached
  y: number;
}

export interface ConnectorItem extends Base {
  type: "connector";
  from: End;
  to: End;
  route: Route;
  endArrow: boolean;
  startArrow: boolean;
  stroke: string;
  label: string;
}

export interface DrawingItem extends Base {
  type: "drawing";
  points: number[]; // flat x,y pairs relative to x,y
  stroke: string;
  width: number;
  highlighter: boolean;
}

export interface FrameItem extends Base {
  type: "frame";
  title: string;
}

export interface ImageItem extends Base {
  type: "image";
  assetId: string;
  src: string; // same-origin URL that checks board access
  alt: string; // file name until someone writes a description
}

export type Item = StickyItem | TextItem | ShapeItem | ConnectorItem | DrawingItem | FrameItem | ImageItem;
export type ItemType = Item["type"];
export type Patch = Partial<Omit<StickyItem, "id" | "type">> &
  Partial<Omit<TextItem, "id" | "type">> &
  Partial<Omit<ShapeItem, "id" | "type">> &
  Partial<Omit<ConnectorItem, "id" | "type">> &
  Partial<Omit<DrawingItem, "id" | "type">> &
  Partial<Omit<FrameItem, "id" | "type">> &
  Partial<Omit<ImageItem, "id" | "type">>;

export const STICKY_SIZE = 200;
export const hasText = (i: Item): i is StickyItem | TextItem | ShapeItem => i.type === "sticky" || i.type === "text" || i.type === "shape";

export function itemsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap("items");
}

export function readItem(m: Y.Map<unknown>): Item {
  return m.toJSON() as Item;
}

/** Frames always sit under everything else; otherwise by z. */
export function readAll(doc: Y.Doc): Item[] {
  const out: Item[] = [];
  itemsMap(doc).forEach((m) => out.push(readItem(m)));
  return out.sort((a, b) => Number(b.type === "frame") - Number(a.type === "frame") || a.z - b.z || a.id.localeCompare(b.id));
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

type NewItem<T extends Item> = Omit<T, "id" | "z" | "createdBy" | "updatedAt">;

export function addItem<T extends Item>(doc: Y.Doc, item: NewItem<T>, userId: string): T {
  const full = { ...item, id: nanoid(12), z: topZ(doc) + 1, createdBy: userId, updatedAt: Date.now() } as T;
  doc.transact(() => itemsMap(doc).set(full.id, toYMap(full)));
  return full;
}

export function addSticky(doc: Y.Doc, at: { x: number; y: number }, userId: string, opts: { color?: string; text?: string } = {}): StickyItem {
  return addItem<StickyItem>(
    doc,
    {
      type: "sticky",
      x: Math.round(at.x - STICKY_SIZE / 2),
      y: Math.round(at.y - STICKY_SIZE / 2),
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      color: opts.color ?? DEFAULT_STICKY,
      text: opts.text ?? "",
    },
    userId,
  );
}

export function updateItems(doc: Y.Doc, changes: { id: string; patch: Patch }[]) {
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

/** Deleting an item also deletes connectors attached to it. */
export function deleteItems(doc: Y.Doc, ids: string[]) {
  const items = itemsMap(doc);
  const gone = new Set(ids);
  items.forEach((m, id) => {
    if (m.get("type") !== "connector") return;
    const from = m.get("from") as End;
    const to = m.get("to") as End;
    if ((from.itemId && gone.has(from.itemId)) || (to.itemId && gone.has(to.itemId))) gone.add(id);
  });
  doc.transact(() => gone.forEach((id) => items.delete(id)));
}

/** Copies items; connectors between copied items are re-pointed at the copies. */
export function duplicateItems(doc: Y.Doc, ids: string[], userId: string, offset = 24): string[] {
  const items = itemsMap(doc);
  let z = topZ(doc);
  const idMap = new Map<string, string>();
  ids.forEach((id) => items.has(id) && idMap.set(id, nanoid(12)));
  const moveEnd = (e: End): End =>
    e.itemId ? (idMap.has(e.itemId) ? { ...e, itemId: idMap.get(e.itemId) } : { x: e.x + offset, y: e.y + offset }) : { x: e.x + offset, y: e.y + offset };
  doc.transact(() => {
    for (const [oldId, newId] of idMap) {
      const src = readItem(items.get(oldId)!);
      const copy = { ...src, id: newId, x: src.x + offset, y: src.y + offset, z: ++z, createdBy: userId, updatedAt: Date.now() } as Item;
      if (copy.type === "connector") {
        copy.from = moveEnd(copy.from);
        copy.to = moveEnd(copy.to);
      }
      items.set(newId, toYMap(copy));
    }
  });
  return [...idMap.values()];
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

/** Size an image so its longer side is at most `max` board units, keeping its proportions. */
export function fitImage(width: number, height: number, max = 480): { w: number; h: number } {
  if (!(width > 0 && height > 0)) return { w: max, h: max };
  const k = Math.min(1, max / Math.max(width, height));
  return { w: Math.round(width * k), h: Math.round(height * k) };
}

// ---------- geometry ----------

export type Box = { x: number; y: number; w: number; h: number };
export const boxOf = (i: Pick<Item, "x" | "y" | "w" | "h">): Box => ({ x: i.x, y: i.y, w: i.w, h: i.h });
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

type Side = "left" | "right" | "top" | "bottom";
type Anchor = { x: number; y: number; side?: Side };

/** Where a line from the box centre towards `toward` leaves the box: the anchor a connector attaches to. */
export function anchorOn(b: Box, toward: { x: number; y: number }): Anchor {
  const c = centre(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  // Snap to the middle of the side facing the other end, like a whiteboard does.
  if (Math.abs(dx) * b.h > Math.abs(dy) * b.w) return { x: dx > 0 ? b.x + b.w : b.x, y: c.y, side: dx > 0 ? "right" : "left" };
  return { x: c.x, y: dy > 0 ? b.y + b.h : b.y, side: dy > 0 ? "bottom" : "top" };
}

/** Polyline points for a connector, given the current position of the items it is attached to. */
export function connectorPoints(c: ConnectorItem, lookup: (id: string) => Box | undefined): number[] {
  const fb = c.from.itemId ? lookup(c.from.itemId) : undefined;
  const tb = c.to.itemId ? lookup(c.to.itemId) : undefined;
  const fRef = fb ? centre(fb) : c.from;
  const tRef = tb ? centre(tb) : c.to;
  const a: Anchor = fb ? anchorOn(fb, tRef) : { x: c.from.x, y: c.from.y };
  const b: Anchor = tb ? anchorOn(tb, fRef) : { x: c.to.x, y: c.to.y };
  if (c.route === "straight") return [a.x, a.y, b.x, b.y];
  // Elbow: leave and arrive perpendicular to the side when attached.
  const horizontalStart = a.side ? a.side === "left" || a.side === "right" : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horizontalStart) {
    const mx = (a.x + b.x) / 2;
    return [a.x, a.y, mx, a.y, mx, b.y, b.x, b.y];
  }
  const my = (a.y + b.y) / 2;
  return [a.x, a.y, a.x, my, b.x, my, b.x, b.y];
}

export function bboxOfPoints(points: number[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Ramer–Douglas–Peucker: drop points that do not change the stroke's shape by more than `eps`. */
export function simplify(points: number[], eps = 1.2): number[] {
  if (points.length <= 4) return points;
  const n = points.length / 2;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = points[s * 2], ay = points[s * 2 + 1], bx = points[e * 2], by = points[e * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, dist = 0;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((by - ay) * points[i * 2] - (bx - ax) * points[i * 2 + 1] + bx * ay - by * ax) / len;
      if (d > dist) {
        dist = d;
        best = i;
      }
    }
    if (dist > eps && best > 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

/** Items whose whole box lies inside the frame: they move with it. */
export function itemsInside(frame: Box, items: Item[], exclude: string): string[] {
  return items
    .filter((i) => i.id !== exclude && i.type !== "connector" && i.x >= frame.x && i.y >= frame.y && i.x + i.w <= frame.x + frame.w && i.y + i.h <= frame.y + frame.h)
    .map((i) => i.id);
}
