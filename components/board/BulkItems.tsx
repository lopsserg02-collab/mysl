"use client";
import { memo, useRef } from "react";
import { Shape } from "react-konva";
import type Konva from "konva";
import { connectorPoints, type Box, type Item } from "@/lib/board/model";
import { CANVAS, inkOn, stickyPair, type BoardLook } from "@/lib/board/palette";
import { FRAME_TITLE_PX } from "@/lib/board/hit";
import { loadedImage } from "./ItemView";
import { FONT } from "./text";

// Tiles are this many screen pixels square, plus a small bleed so neighbouring tiles overlap and leave no seam.
const TILE_PX = 256;
const BLEED_PX = 2;
// Tiles kept in memory, beyond those on screen.
const SPARE_TILES = 64;

type Tile = { canvas: HTMLCanvasElement; dirty: boolean };
type Cache = { scale: number; look: BoardLook | null; ratio: number; tiles: Map<string, Tile>; boxes: Map<string, Box>; drawn: Map<string, Item>; boxScale: number };

/**
 * Far out (low detail) the board draws every item in view from one canvas shape, in stacking order: a plain
 * box per note, shape, text and picture, lines as polylines, frames with their titles. Thousands of separate
 * canvas nodes cost far more to draw and to reconcile than the drawing itself. The shape does not take part
 * in hit-testing; the board finds items under the pointer by geometry (lib/board/hit.ts).
 *
 * The drawing is kept in screen-sized tiles. An edit redraws only the tiles under the item's old and new place,
 * and a pan at the same zoom reuses the tiles it already has; a change of zoom draws directly until it settles.
 */
export const BulkItems = memo(function BulkItems({ items, byId, look, scale }: { items: Item[]; byId: Map<string, Item>; look: BoardLook; scale: number; version: unknown }) {
  const cache = useRef<Cache>({ scale: 0, look: null, ratio: 0, tiles: new Map(), boxes: new Map(), drawn: new Map(), boxScale: 0 }).current;
  const lookup = (id: string): Box | undefined => byId.get(id);
  const titleH = FRAME_TITLE_PX / scale;

  // Where an item draws (connectors follow the items they are attached to).
  const boxOf = (i: Item): Box => {
    if (i.type === "connector") {
      const pts = connectorPoints(i, lookup);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        if (pts[k] < x0) x0 = pts[k];
        if (pts[k] > x1) x1 = pts[k];
        if (pts[k + 1] < y0) y0 = pts[k + 1];
        if (pts[k + 1] > y1) y1 = pts[k + 1];
      }
      const pad = 2 / scale;
      return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }
    if (i.type === "frame") return { x: i.x - 1 / scale, y: i.y - titleH, w: Math.max(i.w, 400 / scale) + 2 / scale, h: i.h + titleH + 1 / scale };
    const pad = i.type === "drawing" ? i.width : 1 / scale;
    return { x: i.x - pad, y: i.y - pad, w: i.w + pad * 2, h: i.h + pad * 2 };
  };

  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const ts = TILE_PX / scale; // tile side in board units
  const bleed = BLEED_PX / scale;
  // Same zoom and look as the tiles were drawn at: mark only the tiles under what changed.
  const reuse = cache.scale === scale && cache.look === look && cache.ratio === ratio;
  if (!reuse) cache.tiles.clear();
  const mark = (b: Box) => {
    for (let tx = Math.floor((b.x - bleed) / ts); tx <= Math.floor((b.x + b.w + bleed) / ts); tx++)
      for (let ty = Math.floor((b.y - bleed) / ts); ty <= Math.floor((b.y + b.h + bleed) / ts); ty++) {
        const t = cache.tiles.get(`${tx},${ty}`);
        if (t) t.dirty = true;
      }
  };
  // Boxes are kept between renders and worked out again only for items that changed (an edit replaces the item).
  if (cache.boxScale !== scale) {
    cache.boxes = new Map();
    cache.drawn = new Map();
    cache.boxScale = scale;
  }
  const { boxes, drawn } = cache;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of items) {
    const before = drawn.get(i.id);
    let b = boxes.get(i.id);
    if (before !== i || !b || i.type === "connector") {
      const nb = boxOf(i);
      if (!b || nb.x !== b.x || nb.y !== b.y || nb.w !== b.w || nb.h !== b.h || before !== i) {
        if (reuse) {
          if (b) mark(b);
          mark(nb);
        }
        boxes.set(i.id, nb);
        b = nb;
      }
      if (before !== i) drawn.set(i.id, i);
    }
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (drawn.size > items.length) {
    // Something left the list (deleted, or out of view): clear where it was.
    const now = new Set(items.map((i) => i.id));
    drawn.forEach((_, id) => {
      if (now.has(id)) return;
      const b = boxes.get(id);
      if (b && reuse) mark(b);
      drawn.delete(id);
      boxes.delete(id);
    });
  }
  if (!Number.isFinite(minX)) return null;

  const paint = (ctx: CanvasRenderingContext2D, region: Box | null) => {
    const thin = 1 / scale;
    let fill = "";
    const setFill = (c: string) => {
      if (c !== fill) {
        ctx.fillStyle = c;
        fill = c;
      }
    };
    let complete = true;
    for (const i of items) {
      if (region) {
        const b = boxes.get(i.id)!;
        if (b.x > region.x + region.w || b.y > region.y + region.h || b.x + b.w < region.x || b.y + b.h < region.y) continue;
      }
      switch (i.type) {
        case "sticky":
          setFill(stickyPair(i.color).fill);
          ctx.fillRect(i.x, i.y, i.w, i.h);
          break;
        case "text":
          ctx.globalAlpha = 0.2;
          setFill(inkOn(look, i.color));
          ctx.fillRect(i.x, i.y, i.w, i.h);
          ctx.globalAlpha = 1;
          break;
        case "shape":
          if (i.fill !== "none") {
            setFill(stickyPair(i.fill).fill);
            ctx.fillRect(i.x, i.y, i.w, i.h);
          }
          ctx.strokeStyle = inkOn(look, i.stroke);
          ctx.lineWidth = thin;
          ctx.strokeRect(i.x, i.y, i.w, i.h);
          break;
        case "image": {
          const img = loadedImage(i.src);
          if (img) ctx.drawImage(img, i.x, i.y, i.w, i.h);
          else {
            complete = false;
            setFill(CANVAS.placeholder);
            ctx.fillRect(i.x, i.y, i.w, i.h);
          }
          break;
        }
        case "frame":
          setFill(look["frame-fill"]);
          ctx.fillRect(i.x, i.y, i.w, i.h);
          ctx.strokeStyle = look["frame-border"];
          ctx.lineWidth = thin;
          ctx.strokeRect(i.x, i.y, i.w, i.h);
          setFill(look["frame-title"]);
          ctx.font = `${13 / scale}px ${FONT}`;
          ctx.textBaseline = "top";
          ctx.fillText(i.title || "Рамка", i.x, i.y - titleH);
          break;
        case "connector":
        case "drawing": {
          const pts = i.type === "connector" ? connectorPoints(i, lookup) : i.points;
          const dx = i.type === "connector" ? 0 : i.x;
          const dy = i.type === "connector" ? 0 : i.y;
          ctx.beginPath();
          ctx.moveTo(pts[0] + dx, pts[1] + dy);
          for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k] + dx, pts[k + 1] + dy);
          ctx.strokeStyle = inkOn(look, i.stroke);
          ctx.lineWidth = i.type === "connector" ? 2 / scale : i.width;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          if (i.type === "drawing" && i.highlighter) ctx.globalAlpha = 0.35;
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
      }
    }
    return complete;
  };

  const ox = minX;
  const oy = minY;
  const draw = (context: Konva.Context) => {
    const ctx = (context as unknown as { _context: CanvasRenderingContext2D })._context;
    ctx.save();
    ctx.translate(-ox, -oy);
    if (!reuse) {
      // The zoom is changing: draw straight away, and keep tiles once it holds still.
      paint(ctx, null);
      cache.scale = scale;
      cache.look = look;
      cache.ratio = ratio;
      ctx.restore();
      return;
    }
    const side = Math.ceil((TILE_PX + BLEED_PX * 2) * ratio);
    const keep = new Set<string>();
    for (let tx = Math.floor(minX / ts); tx <= Math.floor(maxX / ts); tx++)
      for (let ty = Math.floor(minY / ts); ty <= Math.floor(maxY / ts); ty++) {
        const key = `${tx},${ty}`;
        keep.add(key);
        let t = cache.tiles.get(key);
        if (!t) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = side;
          t = { canvas, dirty: true };
          cache.tiles.set(key, t);
        }
        const x = tx * ts - bleed;
        const y = ty * ts - bleed;
        if (t.dirty) {
          const tc = t.canvas.getContext("2d")!;
          tc.setTransform(1, 0, 0, 1, 0, 0);
          tc.clearRect(0, 0, side, side);
          const k = scale * ratio;
          tc.setTransform(k, 0, 0, k, -x * k, -y * k);
          t.dirty = !paint(tc, { x, y, w: ts + bleed * 2, h: ts + bleed * 2 });
        }
        ctx.drawImage(t.canvas, x, y, ts + bleed * 2, ts + bleed * 2);
      }
    // Forget tiles far from view.
    if (cache.tiles.size > keep.size + SPARE_TILES) cache.tiles.forEach((_, key) => !keep.has(key) && cache.tiles.delete(key));
    ctx.restore();
  };

  return <Shape x={ox} y={oy} width={maxX - ox} height={maxY - oy} sceneFunc={draw} listening={false} perfectDrawEnabled={false} />;
});
