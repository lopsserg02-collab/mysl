"use client";
import { t } from "@/lib/copy";
import { BRUSH, type BrushTool } from "@/lib/board/brush";

/** Preset sizes as dots plus a slider, for the pen, the highlighter, the eraser or a selected drawing. */
export function BrushSize({ tool, value, onChange, vertical }: { tool: BrushTool; value: number | undefined; onChange: (v: number) => void; vertical?: boolean }) {
  const spec = BRUSH[tool];
  const label = tool === "eraser" ? t.brush.eraserSize : t.brush.size;
  const biggest = spec.presets[spec.presets.length - 1];
  return (
    <div role="group" aria-label={label} title={t.brush.hint} className={`flex items-center gap-1 p-1 ${vertical ? "flex-col" : ""}`}>
      <div role="radiogroup" aria-label={label} className={`flex gap-0.5 ${vertical ? "flex-col" : ""}`}>
        {spec.presets.map((s) => {
          const dot = 4 + (14 * Math.sqrt(s)) / Math.sqrt(biggest);
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={value === s}
              aria-label={t.brush.preset(s)}
              title={t.brush.preset(s)}
              onClick={() => onChange(s)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ${value === s ? "bg-accent-subtle text-accent" : "text-text hover:bg-surface-hover"}`}
            >
              <span aria-hidden className="rounded-full bg-current" style={{ width: dot, height: dot }} />
            </button>
          );
        })}
      </div>
      <input
        type="range"
        aria-label={label}
        min={spec.min}
        max={spec.max}
        step={1}
        value={value ?? spec.initial}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`accent-[var(--color-accent)] ${vertical ? "h-24 w-6 [direction:rtl] [writing-mode:vertical-lr]" : "w-24"}`}
      />
      <span aria-hidden className="w-8 text-center text-xs tabular-nums text-text-muted">{value ?? "–"}</span>
    </div>
  );
}
