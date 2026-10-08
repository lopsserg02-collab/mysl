// Hit-testing by geometry for the far-out view, where items are drawn in bulk and have no canvas node of their own.
import { connectorPoints, type Box, type Item } from "./model";
import { strokeHits } from "./brush";

export type Hit = { id: string | null; title: boolean };

/** Height of a frame's title strip above the frame, in screen pixels (matches the frame title drawing). */
export const FRAME_TITLE_PX = 22;

function nearPolyline(pts: number[], p: { x: number; y: number }, r: number): boolean {
  return strokeHits({ x: 0, y: 0, points: pts, width: 0 }, p, r);
}

/**
 * The topmost item at board point `p`, scanning `items` (in drawing order) from the top. A frame counts by its
 * title strip (`title: true`) or, when nothing else is there, by its inside. Lines and strokes count within a few
 * screen pixels.
 */
export function hitTest(items: Item[], p: { x: number; y: number }, scale: number, lookup: (id: string) => Box | undefined): Hit {
  const slack = 6 / scale;
  let frameInside: string | null = null;
  for (let k = items.length - 1; k >= 0; k--) {
    const i = items[k];
    if (i.type === "connector") {
      if (nearPolyline(connectorPoints(i, lookup), p, slack)) return { id: i.id, title: false };
      continue;
    }
    if (i.type === "frame") {
      const top = i.y - FRAME_TITLE_PX / scale;
      if (p.x >= i.x && p.x <= i.x + Math.max(i.w, 120 / scale) && p.y >= top && p.y < i.y) return { id: i.id, title: true };
      if (!frameInside && p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h) frameInside = i.id;
      continue;
    }
    if (p.x < i.x - slack || p.x > i.x + i.w + slack || p.y < i.y - slack || p.y > i.y + i.h + slack) continue;
    if (i.type === "drawing") {
      if (strokeHits(i, p, slack)) return { id: i.id, title: false };
      continue;
    }
    if (p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h) return { id: i.id, title: false };
  }
  return { id: frameInside, title: false };
}
