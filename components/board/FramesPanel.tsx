"use client";
import { useEffect, useRef, useState } from "react";
import { Frame, Pencil, X } from "lucide-react";
import { t } from "@/lib/copy";
import type { FrameItem } from "@/lib/board/model";

/** Frames in reading order: top to bottom, then left to right. */
export function frameOrder(frames: FrameItem[]): FrameItem[] {
  return [...frames].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
}

/** Right-docked list of the board's frames: click one to bring it into view, rename in place. */
export function FramesPanel({
  frames,
  canRename,
  current,
  onShow,
  onRename,
  onClose,
}: {
  frames: FrameItem[];
  canRename: boolean;
  current: string | null;
  onShow: (f: FrameItem) => void;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const ordered = frameOrder(frames);

  // Focus moves into the panel when it opens.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

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
        <ol aria-label={t.frames.title} className="flex-1 overflow-y-auto p-1">
          {ordered.map((f, n) => {
            const name = f.title || t.frames.untitled;
            return (
              <li key={f.id} className={`group flex h-10 items-center gap-1 rounded-sm ${current === f.id ? "bg-accent-subtle" : "hover:bg-surface-hover"}`}>
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
                      onClick={() => onShow(f)}
                      onDoubleClick={() => canRename && setRenaming(f.id)}
                      className="flex h-10 min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm"
                    >
                      <span className="w-5 shrink-0 text-xs tabular-nums text-text-muted">{n + 1}</span>
                      <Frame size={16} aria-hidden className="shrink-0 text-text-muted" />
                      <span className={`truncate ${f.title ? "" : "italic text-text-muted"}`}>{name}</span>
                    </button>
                    {canRename && (
                      <button
                        type="button"
                        aria-label={t.frames.rename(name)}
                        title={t.frames.rename(name)}
                        onClick={() => setRenaming(f.id)}
                        className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-active hover:text-text"
                      >
                        <Pencil size={14} aria-hidden />
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
