// Brush sizes for the pen, the highlighter and the eraser.
// Pen and highlighter widths are in board units (a stroke keeps its look at any zoom);
// the eraser's is its diameter in screen pixels (it feels the same at any zoom).

export type BrushTool = "pen" | "highlighter" | "eraser";

export const BRUSH: Record<BrushTool, { presets: number[]; min: number; max: number; initial: number }> = {
  pen: { presets: [1, 2, 3, 5, 8, 12], min: 1, max: 24, initial: 3 },
  highlighter: { presets: [8, 12, 16, 24, 32, 48], min: 4, max: 64, initial: 16 },
  eraser: { presets: [8, 16, 24, 40, 64, 96], min: 4, max: 128, initial: 24 },
};

export type BrushSizes = Record<BrushTool, number>;
export const INITIAL_SIZES: BrushSizes = { pen: BRUSH.pen.initial, highlighter: BRUSH.highlighter.initial, eraser: BRUSH.eraser.initial };

export const clampSize = (tool: BrushTool, v: number) => Math.round(Math.min(BRUSH[tool].max, Math.max(BRUSH[tool].min, v)));

/** The next preset above (dir 1) or below (dir -1) the current size; past the last preset, stays at the end. */
export function stepSize(tool: BrushTool, current: number, dir: 1 | -1): number {
  const p = BRUSH[tool].presets;
  if (dir > 0) return p.find((s) => s > current) ?? Math.max(current, p[p.length - 1]);
  return [...p].reverse().find((s) => s < current) ?? Math.min(current, p[0]);
}

/** Sizes saved by this browser, checked: anything missing or out of range falls back to the default. */
export function parseSizes(raw: string | null): BrushSizes {
  const out = { ...INITIAL_SIZES };
  try {
    const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const tool of Object.keys(BRUSH) as BrushTool[]) {
      const n = v[tool];
      if (typeof n === "number" && Number.isFinite(n)) out[tool] = clampSize(tool, n);
    }
  } catch {
    // keep the defaults
  }
  return out;
}

/** Does a freehand stroke (points relative to x, y) pass within `r` of point `c`? */
export function strokeHits(d: { x: number; y: number; points: number[]; width: number }, c: { x: number; y: number }, r: number): boolean {
  const reach = r + d.width / 2;
  const px = c.x - d.x;
  const py = c.y - d.y;
  const pts = d.points;
  if (pts.length === 2) return Math.hypot(pts[0] - px, pts[1] - py) <= reach;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    if (Math.hypot(ax + dx * t - px, ay + dy * t - py) <= reach) return true;
  }
  return false;
}
