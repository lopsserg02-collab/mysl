import { ZOOM } from "@/lib/board/palette";
import type { Item } from "@/lib/board/model";

export interface Viewport {
  x: number; // screen offset of board origin
  y: number;
  scale: number;
}

export const clampScale = (s: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, s));

export const toBoard = (v: Viewport, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale });

export function zoomAt(v: Viewport, screen: { x: number; y: number }, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  const b = toBoard(v, screen);
  return { scale, x: screen.x - b.x * scale, y: screen.y - b.y * scale };
}

export function stepZoom(v: Viewport, dir: 1 | -1, center: { x: number; y: number }): Viewport {
  const steps = ZOOM.steps;
  const next = dir > 0 ? steps.find((s) => s > v.scale + 1e-6) ?? ZOOM.max : [...steps].reverse().find((s) => s < v.scale - 1e-6) ?? ZOOM.min;
  return zoomAt(v, center, next);
}

export function bounds(items: Pick<Item, "x" | "y" | "w" | "h">[]) {
  if (items.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of items) {
    minX = Math.min(minX, i.x);
    minY = Math.min(minY, i.y);
    maxX = Math.max(maxX, i.x + i.w);
    maxY = Math.max(maxY, i.y + i.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function fitTo(box: { x: number; y: number; w: number; h: number } | null, size: { w: number; h: number }, pad = 80): Viewport {
  if (!box) return { x: size.w / 2, y: size.h / 2, scale: 1 };
  const scale = clampScale(Math.min((size.w - pad * 2) / box.w, (size.h - pad * 2) / box.h, 1));
  return { scale, x: size.w / 2 - (box.x + box.w / 2) * scale, y: size.h / 2 - (box.y + box.h / 2) * scale };
}

export const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
