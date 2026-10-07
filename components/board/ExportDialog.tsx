"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { t } from "@/lib/copy";
import type { ExportFormat, ExportScope } from "./exportBoard";

/** S14: choose format, what to save and quality, then download. */
export function ExportDialog(props: {
  open: boolean;
  onClose: () => void;
  hasSelection: boolean;
  frameCount: number;
  empty: boolean;
  onExport: (o: { format: ExportFormat; scope: ExportScope; quality: number }) => Promise<void>;
}) {
  const { open, onClose, hasSelection, frameCount, empty, onExport } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scope, setScope] = useState<ExportScope>("board");
  const [quality, setQuality] = useState(2);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setState("idle");
      setScope(hasSelection ? "selection" : "board");
    } else if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Frames as pages only make sense in a PDF.
  const effectiveScope = scope === "frames" && format !== "pdf" ? "board" : scope;

  const radio = <T extends string | number>(name: string, value: T, current: T, set: (v: T) => void, label: string, disabled = false) => (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
      <input type="radio" name={name} checked={current === value} disabled={disabled} onChange={() => set(value)} className="accent-[var(--color-accent)]" />
      {label}
    </label>
  );

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="export-title"
      className="w-[min(420px,calc(100vw-32px))] rounded-lg bg-bg p-0 text-text shadow-pop backdrop:bg-black/30"
    >
      <form
        className="flex flex-col gap-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setState("saving");
          try {
            await onExport({ format, scope: effectiveScope, quality });
            onClose();
          } catch {
            setState("failed");
          }
        }}
      >
        <div className="flex items-center justify-between">
          <h2 id="export-title" className="text-lg font-semibold">{t.export.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.share.close} className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-surface-hover">
            <X size={18} aria-hidden />
          </button>
        </div>
        {empty ? (
          <p className="text-sm text-text-muted">{t.export.empty}</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{t.export.format}</legend>
              {radio<ExportFormat>("format", "png", format, setFormat, t.export.png)}
              {radio<ExportFormat>("format", "pdf", format, setFormat, t.export.pdf)}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{t.export.scope}</legend>
              {radio<ExportScope>("scope", "board", effectiveScope, setScope, t.export.board)}
              {radio<ExportScope>("scope", "selection", effectiveScope, setScope, t.export.selection, !hasSelection)}
              {frameCount > 0 && radio<ExportScope>("scope", "frames", effectiveScope, setScope, t.export.frames(frameCount), format !== "pdf")}
              {frameCount > 0 && format !== "pdf" && <p className="text-xs text-text-muted">{t.export.framesPdfOnly}</p>}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{t.export.quality}</legend>
              {radio("quality", 1, quality, setQuality, t.export.q1)}
              {radio("quality", 2, quality, setQuality, t.export.q2)}
              {radio("quality", 3, quality, setQuality, t.export.q3)}
            </fieldset>
            {state === "failed" && <p role="alert" className="text-sm text-danger">{t.export.failed}</p>}
            <button type="submit" disabled={state === "saving"} className="h-10 rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60">
              {state === "saving" ? t.export.saving : t.export.save}
            </button>
          </>
        )}
      </form>
    </dialog>
  );
}
