import { fitFontSize, wrap, type Measure } from "@/lib/board/fit";
import type { ShapeItem, StickyItem, TextItem } from "@/lib/board/model";

export const PAD = 14;
export const FONT = "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/** Bold and italic of a free text item, as a CSS/Konva font style prefix ("", "bold", "italic bold"). */
export type FontStyle = string;
export const fontStyleOf = (i: { bold?: boolean; italic?: boolean }): FontStyle => [i.italic && "italic", i.bold && "bold"].filter(Boolean).join(" ");

let ctx: CanvasRenderingContext2D | null = null;
const measureStyled = (text: string, size: number, style: FontStyle) => {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size * (style.includes("bold") ? 0.66 : 0.6);
  ctx.font = `${style} ${size}px ${FONT}`.trim();
  return ctx.measureText(text).width;
};
export const measure: Measure = (text, size) => measureStyled(text, size, "");
const measureFor = (style: FontStyle): Measure => (style ? (t, s) => measureStyled(t, s, style) : measure);

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
export function textHeight(text: string, width: number, fontSize: number, style: FontStyle = "") {
  const lines = Math.max(1, wrap(text || " ", fontSize, width, measureFor(style)).length);
  return Math.ceil(lines * fontSize * 1.3);
}

/** Free text grows sideways as you type, until it reaches a comfortable reading width. */
export function autoTextWidth(text: string, fontSize: number, style: FontStyle = "") {
  const m = measureFor(style);
  const longest = Math.max(...(text || " ").split("\n").map((l) => m(l, fontSize)));
  return Math.ceil(Math.min(640, Math.max(60, longest + fontSize * 0.5)));
}

/** Width and height a free text item needs, with `over` applied (new text, size or style). */
export function fitText(i: TextItem, over: Partial<TextItem> = {}): { w: number; h: number } {
  const n = { ...i, ...over };
  const style = fontStyleOf(n);
  const w = n.fixedWidth ? n.w : autoTextWidth(n.text, n.fontSize, style);
  return { w, h: textHeight(n.text, w, n.fontSize, style) };
}
