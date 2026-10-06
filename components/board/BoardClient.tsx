"use client";
import dynamic from "next/dynamic";
import type { BoardRole } from "@/lib/data/types";
import { t } from "@/lib/copy";

// Konva only runs in the browser.
const Board = dynamic(() => import("./Board").then((m) => m.Board), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-canvas-bg text-text-muted" role="status">
      {t.board.connecting}
    </div>
  ),
});

export function BoardClient(props: { board: { id: string; name: string }; role: BoardRole; user: { id: string; name: string } }) {
  return (
    <div className="fixed inset-0">
      <Board {...props} />
    </div>
  );
}
