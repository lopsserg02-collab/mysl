import { fitFontSize, wrap, type Measure } from "@/lib/board/fit";
import type { ShapeItem, StickyItem } from "@/lib/board/model";

export const PAD = 14;
export const FONT = "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

let ctx: CanvasRenderingContext2D | null = null;
export const measure: Measure = (text, size) => {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size * 0.6;
  ctx.font = `${size}px ${FONT}`;
  return ctx.measureText(text).width;
};

const cache = new Map<string, number>();
/** Sticky and shape text shrinks to fit its box. */
export function fittedFontSize(item: Pick<StickyItem | ShapeItem, "w" | "h" | "text" | "type">) {
  const key = `${item.type}:${item.w}x${item.h}:${item.text}`;
  let v = cache.get(key);
  if (v === undefined) {
    v = fitFontSize(item.text, { width: item.w - PAD * 2, height: item.h - PAD * 2 }, measure, { max: item.type === "shape" ? 24 : 40 });
    if (cache.size > 2000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** Height a free text box needs for its text at its width. */
export function textHeight(text: string, width: number, fontSize: number) {
  const lines = Math.max(1, wrap(text || " ", fontSize, width, measure).length);
  return Math.ceil(lines * fontSize * 1.3);
}

/** Free text grows sideways as you type, until it reaches a comfortable reading width. */
export function autoTextWidth(text: string, fontSize: number) {
  const longest = Math.max(...(text || " ").split("\n").map((l) => measure(l, fontSize)));
  return Math.ceil(Math.min(640, Math.max(60, longest + fontSize * 0.5)));
}
