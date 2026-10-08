"use client";
import { useEffect, useRef, useState } from "react";
import { PaintBucket, X } from "lucide-react";
import { t } from "@/lib/copy";
import { BOARD_BG_NAMES, GRID_STYLES, boardLook, type GridStyle } from "@/lib/board/palette";

/** «Фон доски»: background colour and grid style for everyone on the board. Editors change it; others see it. */
export function BoardLookMenu({
  bg,
  grid,
  canEdit,
  onChange,
  liveInk,
  onLiveInk,
}: {
  bg: string;
  grid: GridStyle;
  canEdit: boolean;
  onChange: (patch: { bg?: string; grid?: GridStyle }) => void;
  liveInk: boolean;
  onLiveInk: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input:checked, input")?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.boardLook.open}
        title={t.boardLook.open}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex h-9 w-9 items-center justify-center rounded-md ${open ? "bg-accent-subtle text-accent" : "hover:bg-surface-hover"}`}
      >
        <PaintBucket size={18} aria-hidden />
      </button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={t.boardLook.open}
          className="absolute right-0 top-11 z-popover flex w-72 max-w-[calc(100vw-24px)] flex-col gap-3 rounded-md border border-border bg-bg p-3 text-text shadow-pop"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t.boardLook.open}</h2>
            <button type="button" onClick={close} aria-label={t.boardLook.close} className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-surface-hover">
              <X size={16} aria-hidden />
            </button>
          </div>
          {!canEdit && <p className="text-xs text-text-muted">{t.boardLook.readOnly}</p>}
          <fieldset disabled={!canEdit} className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold text-text-muted">{t.boardLook.colour}</legend>
            <div className="flex flex-wrap gap-2">
              {BOARD_BG_NAMES.map((name) => {
                const look = boardLook(name);
                return (
                  <label key={name} title={t.boardLook.names[name]} className="relative cursor-pointer has-[:disabled]:cursor-default">
                    <input type="radio" name="board-bg" value={name} checked={bg === name} onChange={() => onChange({ bg: name })} aria-label={t.boardLook.names[name]} className="peer sr-only" />
                    <span
                      aria-hidden
                      className="block h-8 w-8 rounded-full border border-border-input peer-checked:ring-2 peer-checked:ring-accent peer-checked:ring-offset-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-focus"
                      style={{ background: name === "default" ? "var(--color-canvas-bg)" : look.bg }}
                    >
                      <span className="flex h-full items-center justify-center text-xs font-semibold" style={{ color: name === "default" ? "var(--color-text)" : look.ink }}>
                        Аа
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset disabled={!canEdit} className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-semibold text-text-muted">{t.boardLook.grid}</legend>
            <div className="flex gap-1">
              {GRID_STYLES.map((g) => (
                <label key={g} className="flex-1">
                  <input type="radio" name="board-grid" value={g} checked={grid === g} onChange={() => onChange({ grid: g })} className="peer sr-only" />
                  <span className="flex h-8 cursor-pointer items-center justify-center rounded-sm border border-border text-sm peer-checked:border-accent peer-checked:bg-accent-subtle peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-focus peer-disabled:cursor-default">
                    {t.boardLook.grids[g]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex cursor-pointer items-start gap-2 border-t border-border pt-3 text-sm">
            <input type="checkbox" checked={liveInk} onChange={(e) => onLiveInk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
            <span>
              {t.boardLook.liveInk}
              <span className="block text-xs text-text-muted">{t.boardLook.liveInkHint}</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

/** The board's grid as a CSS background, one cell larger than the view and moved by transform when panning. */
export function gridBackground(style: GridStyle, color: string, step: number): React.CSSProperties | null {
  if (style === "none") return null;
  if (style === "dots") return { backgroundImage: `radial-gradient(${color} 1.2px, transparent 1.2px)`, backgroundSize: `${step}px ${step}px` };
  return {
    backgroundImage: `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`,
    backgroundSize: `${step}px ${step}px`,
  };
}
