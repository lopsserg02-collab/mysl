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
  lassoFill: tokens.alpha["lasso-fill"],
  selectionFill: tokens.alpha["selection-fill"],
  shadow: tokens.color.text,
  placeholder: tokens.color["surface-hover"],
  placeholderFailed: tokens.color["danger-subtle"],
  placeholderBorder: tokens.color.border,
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

// Ink for text, shape outlines, connectors and pens: the text colour plus the collaborator hues.
export const INK = [tokens.color.text, ...CURSOR_COLORS.slice(0, 7).map((c) => c.fill)];
export const DEFAULT_INK = INK[0];
export const FRAME = { fill: tokens.color["frame-fill"], title: tokens.color["frame-title"], border: tokens.color.border };

// ---------- board background ----------

export type BoardLook = { bg: string; grid: string; ink: string; "frame-fill": string; "frame-title": string; "frame-border": string; selection: string; dark: boolean };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { _about, ...boardTokens } = tokens.color.board;
export const BOARD_BGS = boardTokens as Record<string, BoardLook>;
export type BoardBg = "default" | keyof typeof boardTokens;
export const BOARD_BG_NAMES: BoardBg[] = ["default", ...(Object.keys(boardTokens) as BoardBg[])];
export type GridStyle = "dots" | "lines" | "none";
export const GRID_STYLES: GridStyle[] = ["dots", "lines", "none"];

/** Colours a board draws with: the theme's canvas for "default", otherwise the chosen background. */
export function boardLook(bg: string | undefined): BoardLook & { custom: boolean } {
  const chosen = bg && bg !== "default" ? BOARD_BGS[bg] : undefined;
  if (chosen) return { ...chosen, custom: true };
  return { bg: CANVAS.bg, grid: CANVAS.grid, ink: DEFAULT_INK, "frame-fill": FRAME.fill, "frame-title": FRAME.title, "frame-border": FRAME.border, selection: CANVAS.selection, dark: false, custom: false };
}

/** The ink an item is drawn with: the default ink follows the board, so it stays readable on a dark one. */
export const inkOn = (look: { ink: string }, color: string) => (color === DEFAULT_INK ? look.ink : color);
