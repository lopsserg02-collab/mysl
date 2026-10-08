import type Konva from "konva";
import type { Box } from "@/lib/board/model";
import type { Viewport } from "./viewport";

export type ExportFormat = "png" | "pdf";
export type ExportScope = "board" | "selection" | "frames";

const PAD = 40; // board units of margin around exported content
const MAX_SIDE = 8000; // browsers refuse canvases much larger than this

/** Renders a region of the board (board coordinates) to a canvas on the board's background (white by default), at `quality` pixels per board unit. */
export function renderRegion(stage: Konva.Stage, vp: Viewport, box: Box, quality: number, pad = PAD, background = "#ffffff"): HTMLCanvasElement {
  const b = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  const perUnit = Math.min(quality, MAX_SIDE / b.w, MAX_SIDE / b.h);
  const shot = stage.toCanvas({
    x: b.x * vp.scale + vp.x,
    y: b.y * vp.scale + vp.y,
    width: b.w * vp.scale,
    height: b.h * vp.scale,
    pixelRatio: perUnit / vp.scale,
  });
  const out = document.createElement("canvas");
  out.width = shot.width;
  out.height = shot.height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(shot, 0, 0);
  return out;
}

export const toPngBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("PNG failed"))), "image/png"));

/** One PDF page per canvas, each page sized to its picture. */
export async function toPdfBlob(pages: HTMLCanvasElement[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const size = (c: HTMLCanvasElement) => [c.width * 0.75, c.height * 0.75] as [number, number]; // px -> pt
  const first = size(pages[0]);
  const pdf = new jsPDF({ unit: "pt", format: first, orientation: first[0] > first[1] ? "landscape" : "portrait", compress: true });
  pages.forEach((c, n) => {
    const [w, h] = size(c);
    if (n > 0) pdf.addPage([w, h], w > h ? "landscape" : "portrait");
    pdf.addImage(c.toDataURL("image/png"), "PNG", 0, 0, w, h);
  });
  return pdf.output("blob");
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A file name from the board name: no path characters, never empty. */
export const fileName = (board: string, ext: string) => `${board.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "board"}.${ext}`;
