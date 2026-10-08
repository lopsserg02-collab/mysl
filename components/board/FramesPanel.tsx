"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Frame, GripVertical, Pencil, X } from "lucide-react";
import { t } from "@/lib/copy";
import { frameOrder, type FrameItem } from "@/lib/board/model";

export { frameOrder };

/**
 * Right-docked list of the board's frames: click one to bring it into view, rename in place, and (for editors)
 * reorder by dragging a row, with the arrow buttons, or with Alt+↑/↓ on a row.
 */
export function FramesPanel({
  frames,
  canRename,
  current,
  onShow,
  onRename,
  onMove,
  onClose,
}: {
  frames: FrameItem[];
  canRename: boolean;
  current: string | null;
  onShow: (f: FrameItem) => void;
  onRename: (id: string, title: string) => void;
  /** Move a frame to position `to` (0-based) of the panel order. */
  onMove: (id: string, to: number) => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null); // gap index the dragged row would land in
  const [announce, setAnnounce] = useState("");
  const ref = useRef<HTMLElement>(null);
  const ordered = frameOrder(frames);
  const canReorder = canRename && ordered.length > 1;

  // Focus moves into the panel when it opens.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  const move = (f: FrameItem, to: number) => {
    const from = ordered.findIndex((o) => o.id === f.id);
    const target = Math.max(0, Math.min(ordered.length - 1, to));
    if (from < 0 || target === from) return;
    onMove(f.id, target);
    setAnnounce(t.frames.moved(f.title || t.frames.untitled, target + 1, ordered.length));
  };

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  return (
    <aside
      ref={ref}
      aria-label={t.frames.title}
      className="absolute bottom-[72px] right-3 top-[72px] z-panel flex w-side-panel max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-md border border-border bg-bg shadow-pop"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !renaming) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">{t.frames.title}</h2>
        <button type="button" aria-label={t.frames.close} title={t.frames.close} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-surface-hover">
          <X size={16} aria-hidden />
        </button>
      </header>
      {ordered.length === 0 ? (
        <p className="p-4 text-sm text-text-muted">{t.frames.empty}</p>
      ) : (
        <>
          {canReorder && <p id="frames-reorder-hint" className="px-3 pt-2 text-xs text-text-muted">{t.frames.reorderHint}</p>}
          <ol
            aria-label={t.frames.title}
            className="flex-1 overflow-y-auto p-1"
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              // Which gap the pointer is nearest to: before the row under it, or after it past its middle.
              const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("li[data-frame]")];
              let gap = rows.length;
              for (let n = 0; n < rows.length; n++) {
                const r = rows[n].getBoundingClientRect();
                if (e.clientY < r.top + r.height / 2) {
                  gap = n;
                  break;
                }
              }
              setDropAt(gap);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const f = ordered.find((o) => o.id === dragging);
              if (f && dropAt !== null) {
                const from = ordered.indexOf(f);
                move(f, dropAt > from ? dropAt - 1 : dropAt);
              }
              endDrag();
            }}
          >
            {ordered.map((f, n) => {
              const name = f.title || t.frames.untitled;
              const line = dragging && dropAt !== null ? (dropAt === n ? "before" : dropAt === ordered.length && n === ordered.length - 1 ? "after" : null) : null;
              return (
                <li
                  key={f.id}
                  data-frame={f.id}
                  draggable={canReorder && renaming !== f.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", name);
                    setDragging(f.id);
                  }}
                  onDragEnd={endDrag}
                  className={`group relative flex h-10 items-center gap-1 rounded-sm ${current === f.id ? "bg-accent-subtle" : "hover:bg-surface-hover"} ${dragging === f.id ? "opacity-50" : ""}`}
                >
                  {line && <span aria-hidden className={`pointer-events-none absolute left-1 right-1 h-0.5 rounded-pill bg-accent ${line === "before" ? "-top-px" : "-bottom-px"}`} />}
                  {canReorder && <GripVertical size={14} aria-hidden className="ml-1 shrink-0 cursor-grab text-text-muted" />}
                  {renaming === f.id ? (
                    <input
                      autoFocus
                      aria-label={t.frames.nameLabel}
                      defaultValue={f.title}
                      placeholder={t.frames.untitled}
                      maxLength={120}
                      className="mx-1 h-8 min-w-0 flex-1 rounded-sm border border-border-input bg-bg px-2 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRename(f.id, e.currentTarget.value.trim());
                          setRenaming(null);
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      onBlur={(e) => {
                        onRename(f.id, e.currentTarget.value.trim());
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={t.frames.show(name)}
                        aria-current={current === f.id || undefined}
                        aria-describedby={canReorder ? "frames-reorder-hint" : undefined}
                        onClick={() => onShow(f)}
                        onDoubleClick={() => canRename && setRenaming(f.id)}
                        onKeyDown={(e) => {
                          if (!canReorder || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                          e.preventDefault();
                          e.stopPropagation();
                          move(f, n + (e.key === "ArrowUp" ? -1 : 1));
                        }}
                        className="flex h-10 min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm"
                      >
                        <span className="w-5 shrink-0 text-xs tabular-nums text-text-muted">{n + 1}</span>
                        <Frame size={16} aria-hidden className="shrink-0 text-text-muted" />
                        <span className={`truncate ${f.title ? "" : "italic text-text-muted"}`}>{name}</span>
                      </button>
                      {canReorder && (
                        <span className="flex shrink-0 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                          <RowButton label={t.frames.moveUp(name)} disabled={n === 0} onClick={() => move(f, n - 1)}>
                            <ChevronUp size={14} aria-hidden />
                          </RowButton>
                          <RowButton label={t.frames.moveDown(name)} disabled={n === ordered.length - 1} onClick={() => move(f, n + 1)}>
                            <ChevronDown size={14} aria-hidden />
                          </RowButton>
                        </span>
                      )}
                      {canRename && (
                        <RowButton label={t.frames.rename(name)} onClick={() => setRenaming(f.id)}>
                          <Pencil size={14} aria-hidden />
                        </RowButton>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          <p role="status" className="sr-only">{announce}</p>
        </>
      )}
    </aside>
  );
}

function RowButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="mr-1 flex h-8 w-7 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-active hover:text-text disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
