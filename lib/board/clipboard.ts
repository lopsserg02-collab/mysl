// Copy and paste of board items through the system clipboard, within a board and between boards.
// The clipboard carries a JSON payload under our own MIME type, plus the items' text as plain text.
import type * as Y from "yjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { connectorPoints, insertItems, topZ, withGroups, type Box, type End, type Item, type ItemType } from "./model";

export const CLIP_MIME = "application/x-mysl-items+json";
const MAX_ITEMS = 20_000;

export interface ClipPayload {
  mysl: 1;
  items: Item[];
}

/** The selection (with whole groups, and connectors between picked items) ready for the clipboard. */
export function copyPayload(all: Item[], ids: string[]): ClipPayload | null {
  const picked = new Set(withGroups(all, ids));
  for (const i of all) {
    if (i.type === "connector" && i.from.itemId && i.to.itemId && picked.has(i.from.itemId) && picked.has(i.to.itemId)) picked.add(i.id);
  }
  const byId = new Map(all.map((i) => [i.id, i]));
  const lookup = (id: string) => byId.get(id);
  const items = all
    .filter((i) => picked.has(i.id))
    .map((i): Item => {
      if (i.type !== "connector") return i;
      // An end attached to something left behind becomes a free point where it is now.
      const pts = connectorPoints(i, lookup);
      const keep = (e: End, x: number, y: number): End => (e.itemId && picked.has(e.itemId) ? e : { x, y });
      return { ...i, from: keep(i.from, pts[0], pts[1]), to: keep(i.to, pts[pts.length - 2], pts[pts.length - 1]) };
    });
  return items.length ? { mysl: 1, items } : null;
}

/** Words on the copied items, for pasting into a text editor. */
export function plainText(p: ClipPayload): string {
  return p.items
    .map((i) => (i.type === "frame" ? i.title : i.type === "connector" ? i.label : i.type === "image" ? i.alt : "text" in i ? i.text : ""))
    .filter(Boolean)
    .join("\n");
}

// Pasted data comes from outside the board: keep only known fields with sane values.
const num = z.number().finite();
const str = (max: number) => z.string().max(max);
const end = z.object({ itemId: str(64).optional(), x: num, y: num });
const base = { id: str(64), x: num, y: num, w: num.min(0).max(1e6), h: num.min(0).max(1e6), z: num, locked: z.boolean().optional(), groupId: str(64).optional() };
const schemas: Record<ItemType, z.ZodType> = {
  sticky: z.object({ ...base, type: z.literal("sticky"), color: str(32), text: str(6000) }),
  text: z.object({ ...base, type: z.literal("text"), text: str(6000), fontSize: num.min(4).max(400), color: str(32), fixedWidth: z.boolean().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional() }),
  shape: z.object({ ...base, type: z.literal("shape"), kind: z.enum(["rect", "round", "ellipse", "triangle", "diamond"]), text: str(6000), fill: str(32), stroke: str(32) }),
  connector: z.object({ ...base, type: z.literal("connector"), from: end, to: end, route: z.enum(["straight", "elbow", "curved"]), endArrow: z.boolean(), startArrow: z.boolean(), stroke: str(32), label: str(200) }),
  drawing: z.object({ ...base, type: z.literal("drawing"), points: z.array(num).max(200_000), stroke: str(32), width: num.min(0).max(200), highlighter: z.boolean() }),
  frame: z.object({ ...base, type: z.literal("frame"), title: str(200) }),
  // Only pictures served by this site, never an arbitrary URL.
  image: z.object({ ...base, type: z.literal("image"), assetId: str(64), src: z.string().max(200).regex(/^\/api\/assets\/[\w-]+$/), alt: str(300) }),
};

/** Reads a clipboard payload; anything that is not ours, or is malformed, gives null. Unknown fields are dropped. */
export function parsePayload(raw: string | null | undefined): ClipPayload | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = data as { mysl?: unknown; items?: unknown };
  if (!d || d.mysl !== 1 || !Array.isArray(d.items) || d.items.length > MAX_ITEMS) return null;
  const items: Item[] = [];
  for (const raw of d.items) {
    const schema = schemas[(raw as { type?: ItemType })?.type as ItemType];
    const r = schema?.safeParse(raw);
    if (r?.success) items.push(r.data as Item);
  }
  return items.length ? { mysl: 1, items } : null;
}

function payloadBox(items: Item[]): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const i of items) {
    if (i.type === "connector") {
      if (!i.from.itemId) add(i.from.x, i.from.y);
      if (!i.to.itemId) add(i.to.x, i.to.y);
    } else {
      add(i.x, i.y);
      add(i.x + i.w, i.y + i.h);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

/**
 * Adds copies of the payload's items centred on `at`, in one transaction (one undo step).
 * Copies get new ids and groups; connectors between copied items attach to the copies.
 */
export function pasteItems(doc: Y.Doc, p: ClipPayload, at: { x: number; y: number }, userId: string): string[] {
  const box = payloadBox(p.items);
  if (!box) return [];
  const dx = Math.round(at.x - (box.x + box.w / 2));
  const dy = Math.round(at.y - (box.y + box.h / 2));
  const ids = new Map(p.items.map((i) => [i.id, nanoid(12)]));
  const groups = new Map<string, string>();
  const regroup = (g: string) => {
    if (!groups.has(g)) groups.set(g, nanoid(12));
    return groups.get(g)!;
  };
  const moveEnd = (e: End): End => (e.itemId && ids.has(e.itemId) ? { itemId: ids.get(e.itemId), x: e.x + dx, y: e.y + dy } : { x: e.x + dx, y: e.y + dy });
  let z = topZ(doc);
  const now = Date.now();
  const copies = [...p.items]
    .sort((a, b) => a.z - b.z)
    .map((src) => {
      const copy = { ...src, id: ids.get(src.id)!, z: ++z, createdBy: userId, updatedAt: now } as Item;
      if (src.groupId) copy.groupId = regroup(src.groupId);
      else delete copy.groupId;
      if (copy.type === "connector") {
        copy.from = moveEnd(copy.from);
        copy.to = moveEnd(copy.to);
      } else {
        copy.x += dx;
        copy.y += dy;
      }
      return copy;
    });
  insertItems(doc, copies);
  return copies.map((c) => c.id);
}
