"use client";
import { memo, useSyncExternalStore } from "react";
import type { Viewport } from "./viewport";
import type { CursorStore } from "./useBoardDoc";

const none: never[] = [];

/** Other people's pointers. Subscribes to the cursor store itself, so a moving cursor re-renders only this layer. */
export const Cursors = memo(function Cursors({ store, vp }: { store: CursorStore; vp: Viewport }) {
  const cursors = useSyncExternalStore(store.subscribe, store.get, () => none);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {cursors.map((c) => (
        <div
          key={c.clientId}
          className="absolute left-0 top-0 transition-transform duration-75 ease-linear will-change-transform"
          style={{ transform: `translate(${c.x * vp.scale + vp.x}px, ${c.y * vp.scale + vp.y}px)` }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 1l6 15 2.2-6.3L16 7.5z" fill={c.color.fill} stroke="var(--color-bg)" strokeWidth="1.2" /></svg>
          <span className="ml-3 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs font-medium" style={{ background: c.color.fill, color: c.color.label }}>{c.name}</span>
        </div>
      ))}
    </div>
  );
});
