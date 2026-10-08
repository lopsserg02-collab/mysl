"use client";
import { memo } from "react";
import { Shape } from "react-konva";
import type Konva from "konva";
import { connectorPoints, type Box, type Item } from "@/lib/board/model";
import { CANVAS, inkOn, stickyPair, type BoardLook } from "@/lib/board/palette";
import { FRAME_TITLE_PX } from "@/lib/board/hit";
import { loadedImage } from "./ItemView";
import { FONT } from "./text";

/**
 * Far out (low detail) the board draws every item in view from one canvas shape, in stacking order: a plain
 * box per note, shape, text and picture, lines as polylines, frames with their titles. Thousands of separate
 * canvas nodes cost far more to draw and to reconcile than the drawing itself. The shape does not take part
 * in hit-testing; the board finds items under the pointer by geometry (lib/board/hit.ts).
 */
export const BulkItems = memo(function BulkItems({ items, byId, look, scale }: { items: Item[]; byId: Map<string, Item>; look: BoardLook; scale: number; version: unknown }) {
  // The shape's own box must cover what it draws, so a cached bitmap of the board includes all of it.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const lookup = (id: string): Box | undefined => byId.get(id);
  for (const i of items) {
    if (i.type === "connector") {
      const pts = connectorPoints(i, lookup);
      for (let k = 0; k < pts.length; k += 2) {
        if (pts[k] < minX) minX = pts[k];
        if (pts[k] > maxX) maxX = pts[k];
        if (pts[k + 1] < minY) minY = pts[k + 1];
        if (pts[k + 1] > maxY) maxY = pts[k + 1];
      }
      continue;
    }
    const top = i.type === "frame" ? i.y - FRAME_TITLE_PX / scale : i.y;
    const pad = i.type === "drawing" ? i.width : 0;
    if (i.x - pad < minX) minX = i.x - pad;
    if (top - pad < minY) minY = top - pad;
    if (i.x + i.w + pad > maxX) maxX = i.x + i.w + pad;
    if (i.y + i.h + pad > maxY) maxY = i.y + i.h + pad;
  }
  if (!Number.isFinite(minX)) return null;
  const margin = 4 / scale;
  const ox = minX - margin;
  const oy = minY - margin;

  const draw = (context: Konva.Context) => {
    const ctx = (context as unknown as { _context: CanvasRenderingContext2D })._context;
    ctx.save();
    ctx.translate(-ox, -oy);
    const thin = 1 / scale;
    let fill = "";
    const setFill = (c: string) => {
      if (c !== fill) {
        ctx.fillStyle = c;
        fill = c;
      }
    };
    for (const i of items) {
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
          ctx.fillText(i.title || "Рамка", i.x, i.y - FRAME_TITLE_PX / scale);
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
    ctx.restore();
  };

  return <Shape x={ox} y={oy} width={maxX - ox + margin} height={maxY - oy + margin} sceneFunc={draw} listening={false} perfectDrawEnabled={false} />;
});
