// Canvas colours come from the design tokens; Konva cannot read CSS variables.
import tokens from "@/design/tokens.json";

type Pair = { fill: string; text: string };
export const STICKY_COLORS = tokens.color.sticky as unknown as Record<string, Pair>;
export type StickyColor = keyof typeof tokens.color.sticky;
export const STICKY_COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];
export const DEFAULT_STICKY: StickyColor = "lemon";

const cursorTokens = tokens.color.cursor as unknown as Record<string, { fill: string; label: string }>;
export const CURSOR_COLORS = Object.values(cursorTokens);

export const CANVAS = {
  bg: tokens.color["canvas-bg"],
  grid: tokens.color["canvas-grid"],
  selection: tokens.color.selection,
  handle: tokens.color["selection-handle"],
};

export const ZOOM = tokens.zoom;

export function stickyPair(color: string): Pair {
  return STICKY_COLORS[color] ?? STICKY_COLORS[DEFAULT_STICKY];
}

// Stable colour per user id so a person keeps the same cursor colour on every board.
export function colorForUser(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}
