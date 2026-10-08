"use client";
import { useEffect, useRef, useState } from "react";
import { Check, GripHorizontal, GripVertical, MoreHorizontal } from "lucide-react";
import { t } from "@/lib/copy";

export type BarSide = "left" | "right" | "top" | "bottom";
export type BarPrefs = { side: BarSide; compact: boolean };
const SIDES: BarSide[] = ["left", "right", "top", "bottom"];
const DEFAULT_PREFS: BarPrefs = { side: "left", compact: false };

/** A per-person setting kept in this browser. Storage can be missing or blocked: the default is used then. */
export function useLocalPref<T>(key: string, initial: T, parse: (raw: string | null) => T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      setValue(parse(window.localStorage.getItem(key)));
    } catch {
      // private mode or blocked storage: keep the default
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // not remembered, still applied
    }
  };
  return [value, set];
}

export function parseBarPrefs(raw: string | null): BarPrefs {
  try {
    const v = JSON.parse(raw ?? "{}") as Partial<BarPrefs>;
    return { side: SIDES.includes(v.side as BarSide) ? (v.side as BarSide) : "left", compact: v.compact === true };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const useToolbarPrefs = () => useLocalPref<BarPrefs>("mysl.toolbar", DEFAULT_PREFS, parseBarPrefs);

export const isVertical = (side: BarSide) => side === "left" || side === "right";

// Where the main toolbar sits. Top stays below the board header; bottom stays clear of the zoom controls
// (above them on narrow screens, beside them on wide ones).
const PLACE: Record<BarSide, string> = {
  left: "left-3 top-1/2 -translate-y-1/2 flex-col max-h-[calc(100%-140px)] overflow-y-auto",
  right: "top-1/2 -translate-y-1/2 flex-col max-h-[calc(100%-140px)] overflow-y-auto",
  top: "inset-x-3 top-[72px] mx-auto w-fit flex-row max-w-[calc(100%-24px)] overflow-x-auto",
  bottom: "left-3 bottom-[72px] flex-row max-w-[calc(100%-24px)] overflow-x-auto md:bottom-3 md:max-w-[calc(100%-380px)]",
};

/** Where a tool's settings (shapes, colours, sizes) open: next to the toolbar, on the board side of it. */
export function settingsPlace(side: BarSide, compact: boolean): { className: string; vertical: boolean } {
  switch (side) {
    case "left":
      return { className: `${compact ? "left-[56px]" : "left-[64px]"} top-1/2 -translate-y-1/2 flex-col`, vertical: true };
    case "right":
      return { className: "top-1/2 -translate-y-1/2 flex-col", vertical: true };
    case "top":
      return { className: `inset-x-3 mx-auto w-fit ${compact ? "top-[116px]" : "top-[124px]"} flex-row flex-wrap justify-center max-w-[calc(100%-24px)]`, vertical: false };
    case "bottom":
      return { className: `left-3 ${compact ? "bottom-[116px] md:bottom-[56px]" : "bottom-[124px] md:bottom-[64px]"} flex-row flex-wrap max-w-[calc(100%-24px)]`, vertical: false };
  }
}


export interface ToolDef {
  id: string;
  label: string;
  icon: (size: number) => React.ReactNode;
  active?: boolean;
  onClick: () => void;
  /** Shown in compact mode; the rest go under «Ещё». */
  primary?: boolean;
  /** A thin line before this tool. */
  divider?: boolean;
}

/**
 * The main toolbar: a grip to drag it to another edge (it snaps to the nearest one on drop) that is also a
 * menu button for the keyboard (left / right / top / bottom, compact), and in compact mode an «Ещё» menu.
 */
export function Toolbar({ prefs, setPrefs, tools, rightOffset }: { prefs: BarPrefs; setPrefs: (p: BarPrefs) => void; tools: ToolDef[]; rightOffset: string }) {
  const { side, compact } = prefs;
  const vertical = isVertical(side);
  const navRef = useRef<HTMLElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<null | "place" | "more">(null);
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; d: { x: number; y: number }; moving: boolean; target: BarSide } | null>(null);
  const [said, setSaid] = useState("");

  const shown = compact ? tools.filter((x) => x.primary) : tools;
  const hidden = compact ? tools.filter((x) => !x.primary) : [];
  const size = compact ? 16 : 20;
  const btn = compact ? "h-8 w-8" : "h-10 w-10";

  const place = (next: BarPrefs) => {
    setPrefs(next);
    if (next.side !== side) setSaid(t.toolbar.moved(t.toolbar[next.side]));
  };

  /** The edge of the board nearest to a point (client coordinates). */
  const nearest = (x: number, y: number): BarSide => {
    const root = navRef.current?.offsetParent?.getBoundingClientRect();
    if (!root) return side;
    const d: [BarSide, number][] = [
      ["left", x - root.left],
      ["right", root.right - x],
      ["top", y - root.top],
      ["bottom", root.bottom - y],
    ];
    return d.sort((a, b) => a[1] - b[1])[0][0];
  };

  return (
    <>
      <nav
        ref={navRef}
        aria-label={t.toolbar.label}
        data-side={side}
        data-compact={compact || undefined}
        className={`absolute z-toolbar flex gap-1 rounded-md bg-bg p-1 shadow-toolbar ${PLACE[side]} ${drag?.moving ? "opacity-80 shadow-pop" : ""}`}
        style={{ ...(side === "right" ? { right: rightOffset } : {}), ...(drag?.moving ? { translate: `${drag.d.x}px ${drag.d.y}px` } : {}) }}
      >
        <button
          ref={gripRef}
          type="button"
          aria-label={t.toolbar.grip}
          title={t.toolbar.grip}
          aria-haspopup="menu"
          aria-expanded={menu === "place"}
          className={`flex shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-text-muted hover:bg-surface-hover hover:text-text ${vertical ? `h-5 ${compact ? "w-8" : "w-10"}` : `w-5 ${compact ? "h-8" : "h-10"}`}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ start: { x: e.clientX, y: e.clientY }, d: { x: 0, y: 0 }, moving: false, target: side });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const d = { x: e.clientX - drag.start.x, y: e.clientY - drag.start.y };
            const moving = drag.moving || Math.hypot(d.x, d.y) > 4;
            setDrag({ ...drag, d, moving, target: moving ? nearest(e.clientX, e.clientY) : side });
          }}
          onPointerUp={() => {
            if (drag?.moving) place({ ...prefs, side: drag.target });
            else if (drag) setMenu((m) => (m === "place" ? null : "place"));
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              setMenu("place");
            }
          }}
        >
          {vertical ? <GripHorizontal size={16} aria-hidden /> : <GripVertical size={16} aria-hidden />}
        </button>
        {shown.map((x) => (
          <span key={x.id} className={`contents`}>
            {x.divider && !compact && <span aria-hidden className={`shrink-0 bg-border ${vertical ? "my-1 h-px w-full" : "mx-1 h-auto w-px self-stretch"}`} />}
            <button
              type="button"
              aria-label={x.label}
              title={x.label}
              aria-pressed={x.active}
              onClick={x.onClick}
              className={`flex shrink-0 items-center justify-center rounded-sm ${btn} ${x.active ? "bg-accent-subtle text-accent" : "text-text hover:bg-surface-hover"}`}
            >
              <span aria-hidden className="contents">{x.icon(size)}</span>
            </button>
          </span>
        ))}
        {hidden.length > 0 && (
          <button
            ref={moreRef}
            type="button"
            aria-label={t.toolbar.more}
            title={t.toolbar.more}
            aria-haspopup="menu"
            aria-expanded={menu === "more"}
            onClick={() => setMenu((m) => (m === "more" ? null : "more"))}
            className={`flex shrink-0 items-center justify-center rounded-sm ${btn} ${hidden.some((x) => x.active) ? "bg-accent-subtle text-accent" : "text-text hover:bg-surface-hover"}`}
          >
            <MoreHorizontal size={size} aria-hidden />
          </button>
        )}
      </nav>
      <p role="status" className="sr-only">{said}</p>

      {/* While dragging: where the toolbar will land. */}
      {drag?.moving && (
        <div
          aria-hidden
          className={`pointer-events-none absolute z-canvas-overlay rounded-md border-2 border-dashed border-accent bg-accent-subtle opacity-60 ${
            drag.target === "left" ? "bottom-[72px] left-1 top-[72px] w-14" : drag.target === "right" ? "bottom-[72px] right-1 top-[72px] w-14" : drag.target === "top" ? "left-3 right-3 top-[68px] h-14" : "bottom-1 left-3 right-3 h-14"
          }`}
        />
      )}

      {menu && (
        <Menu
          label={menu === "place" ? t.toolbar.menu : t.toolbar.moreMenu}
          anchor={(menu === "place" ? gripRef : moreRef).current}
          side={side}
          onClose={(refocus) => {
            setMenu(null);
            if (refocus) (menu === "place" ? gripRef : moreRef).current?.focus({ preventScroll: true });
          }}
        >
          {menu === "place"
            ? [
                ...SIDES.map((s) => (
                  <MenuItem key={s} role="menuitemradio" checked={side === s} onClick={() => place({ ...prefs, side: s })}>
                    {t.toolbar[s]}
                  </MenuItem>
                )),
                <div key="sep" role="separator" className="my-1 h-px bg-border" />,
                <MenuItem key="compact" role="menuitemcheckbox" checked={compact} onClick={() => place({ ...prefs, compact: !compact })}>
                  {t.toolbar.compact}
                </MenuItem>,
              ]
            : hidden.map((x) => (
                <MenuItem key={x.id} role="menuitem" checked={x.active} onClick={x.onClick} icon={x.icon(16)}>
                  {x.label}
                </MenuItem>
              ))}
        </Menu>
      )}
    </>
  );
}

function Menu({ label, anchor, side, onClose, children }: { label: string; anchor: HTMLElement | null; side: BarSide; onClose: (refocus: boolean) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    // Opens beside the button, on the board side of the toolbar, kept inside the window.
    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const gap = 8;
    let left = side === "left" ? a.right + gap : side === "right" ? a.left - gap - m.width : a.left;
    let top = side === "top" ? a.bottom + gap : side === "bottom" ? a.top - gap - m.height : a.top;
    left = Math.max(8, Math.min(window.innerWidth - m.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - m.height - 8, top));
    setPos({ left, top });
  }, [anchor, side]);

  // Focus the first item once the menu is placed (a hidden element cannot take focus).
  const placed = pos.visibility !== "hidden";
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-popover flex min-w-44 flex-col rounded-md border border-border bg-bg p-1 shadow-pop"
      style={pos}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
        const k = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          items[(k + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          items[e.key === "Home" ? 0 : items.length - 1]?.focus({ preventScroll: true });
        }
      }}
      onClick={(e) => {
        // Choosing an item closes the menu.
        if ((e.target as HTMLElement).closest("[role^=menuitem]")) onClose(true);
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({ role, checked, onClick, icon, children }: { role: "menuitem" | "menuitemradio" | "menuitemcheckbox"; checked?: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "menuitem" ? undefined : !!checked}
      tabIndex={-1}
      onClick={onClick}
      className={`flex h-9 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-surface-hover focus-visible:bg-surface-hover ${role === "menuitem" && checked ? "text-accent" : ""}`}
    >
      {role !== "menuitem" ? <span className="flex w-4 justify-center">{checked && <Check size={14} aria-hidden />}</span> : <span aria-hidden className="contents">{icon}</span>}
      {children}
    </button>
  );
}
