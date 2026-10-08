"use client";
import { memo, useSyncExternalStore } from "react";
import { Line } from "react-konva";
import { inkOn, type BoardLook } from "@/lib/board/palette";
import type { InkStore, PeerInk } from "./useBoardDoc";

const none: PeerInk[] = [];

/** Strokes other people are drawing right now, drawn like our own stroke in progress until they let go. */
export const PeerInks = memo(function PeerInks({ store, look }: { store: InkStore; look: BoardLook }) {
  const inks = useSyncExternalStore(store.subscribe, store.get, () => none);
  return (
    <>
      {inks.map((k) => (
        <Line
          key={k.clientId}
          name="peer-ink"
          points={k.points}
          stroke={inkOn(look, k.stroke)}
          strokeWidth={k.width}
          opacity={k.highlighter ? 0.35 : 1}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          listening={false}
        />
      ))}
    </>
  );
});
