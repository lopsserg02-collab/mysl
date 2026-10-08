"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { t } from "@/lib/copy";

/** Every keyboard shortcut of the board, opened with "?" or the keyboard button. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="shortcuts-title"
      className="max-h-[calc(100vh-32px)] w-[min(720px,calc(100vw-32px))] overflow-y-auto rounded-lg bg-bg p-0 text-text shadow-pop backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg font-semibold">{t.shortcuts.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.shortcuts.close} className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-surface-hover">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          {t.shortcuts.groups.map((g) => (
            <section key={g.title} aria-labelledby={`sc-${g.title}`}>
              <h3 id={`sc-${g.title}`} className="mb-2 text-sm font-semibold">{g.title}</h3>
              <dl className="flex flex-col gap-1.5 text-sm">
                {g.keys.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3">
                    <dt className="text-text-muted">{what}</dt>
                    <dd className="shrink-0">
                      <kbd className="rounded-xs border border-border bg-surface px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="text-xs text-text-muted">{t.shortcuts.note}</p>
      </div>
    </dialog>
  );
}
