"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { MoreHorizontal, Star } from "lucide-react";
import type { BoardListItem } from "@/lib/data/types";
import { t } from "@/lib/copy";
import { renameBoard, restoreBoard, setStarred, trashBoard } from "@/app/actions";

const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function BoardCard({ board, trashed }: { board: BoardListItem; trashed: boolean }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const isOwner = board.role === "owner" || board.role === "coowner";

  return (
    <div className="group relative flex h-full flex-col rounded-lg border border-border bg-bg shadow-card" aria-busy={pending}>
      <div className="aspect-[16/10] rounded-t-lg bg-canvas-bg" aria-hidden />
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get("name") ?? "");
                setEditing(false);
                if (name.trim() && name !== board.name) start(() => renameBoard(board.id, name));
              }}
            >
              <label className="sr-only" htmlFor={`rename-${board.id}`}>{t.dash.rename}</label>
              <input
                id={`rename-${board.id}`}
                name="name"
                autoFocus
                maxLength={60}
                defaultValue={board.name}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
                className="h-8 w-full rounded-sm border border-border-input px-2"
              />
            </form>
          ) : trashed ? (
            <span className="block truncate font-semibold">{board.name}</span>
          ) : (
            <Link href={`/board/${board.id}`} className="block truncate font-semibold after:absolute after:inset-0 after:content-['']">
              {board.name}
            </Link>
          )}
          <p className="text-xs text-text-muted">
            {t.dash.edited} {fmt.format(new Date(board.updatedAt))}
          </p>
        </div>
        {!trashed && (
          <button
            aria-label={board.starred ? t.dash.unstar : t.dash.star}
            aria-pressed={board.starred}
            onClick={() => start(() => setStarred(board.id, !board.starred))}
            className="relative z-10 flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-hover"
          >
            <Star size={16} aria-hidden className={board.starred ? "fill-current text-warning" : "text-text-muted"} />
          </button>
        )}
        {isOwner && (
          <div className="relative z-10">
            <button
              aria-label="Действия с доской"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-hover"
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
            {menu && (
              <ul role="menu" className="absolute right-0 top-9 z-20 min-w-44 rounded-md bg-bg p-1 shadow-pop" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
                {trashed ? (
                  <li role="none">
                    <button role="menuitem" className="w-full rounded-sm px-3 py-2 text-left hover:bg-surface-hover" onClick={() => { setMenu(false); start(() => restoreBoard(board.id)); }}>
                      {t.dash.restore}
                    </button>
                  </li>
                ) : (
                  <>
                    <li role="none">
                      <button role="menuitem" className="w-full rounded-sm px-3 py-2 text-left hover:bg-surface-hover" onClick={() => { setMenu(false); setEditing(true); }}>
                        {t.dash.rename}
                      </button>
                    </li>
                    {board.role === "owner" && (
                      <li role="none">
                        <button role="menuitem" className="w-full rounded-sm px-3 py-2 text-left text-danger hover:bg-danger-subtle" onClick={() => { setMenu(false); start(() => trashBoard(board.id)); }}>
                          {t.dash.delete}
                        </button>
                      </li>
                    )}
                  </>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
