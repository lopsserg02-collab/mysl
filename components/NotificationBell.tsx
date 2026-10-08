"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Bell, CheckCheck, UserPlus } from "lucide-react";
import type { AppNotification } from "@/lib/data/types";
import { listNotifications, markNotificationsRead, unreadNotifications } from "@/app/actions";
import { t } from "@/lib/copy";

const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The bell on the dashboard and the board header: mentions and invites, unread count, mark read. */
export function NotificationBell({ initialUnread, className = "" }: { initialUnread?: number; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread ?? 0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // At most one count request per 30 seconds: server actions from a page run one after another.
  const last = useRef(initialUnread === undefined ? 0 : Date.now());
  const count = useCallback(() => {
    if (Date.now() - last.current < 30_000) return;
    last.current = Date.now();
    unreadNotifications().then(setUnread, () => {});
  }, []);
  const load = useCallback(
    () =>
      listNotifications().then(
        (list) => {
          setFailed(false);
          setItems(list);
          setUnread(list.filter((n) => !n.read).length);
        },
        () => setFailed(true),
      ),
    [],
  );

  // Keep the count fresh while the page stays open: on focus and once a minute.
  useEffect(() => {
    if (initialUnread === undefined) void count();
    const onFocus = () => void count();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(count, 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [count, initialUnread]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  const markAll = async () => {
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? list);
    setUnread(0);
    await markNotificationsRead().catch(() => {});
  };

  const go = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read) {
      setUnread((u) => Math.max(0, u - 1));
      await markNotificationsRead([n.id]).catch(() => {});
    }
    router.push(`/board/${n.boardId}`);
  };

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={unread ? t.notifications.unread(unread) : t.notifications.open}
        title={t.notifications.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-hover"
      >
        <Bell size={18} aria-hidden />
        {unread > 0 && (
          <span aria-hidden data-testid="unread-badge" className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-danger px-1 text-[11px] font-semibold leading-none text-on-danger">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label={t.notifications.title} className="absolute right-0 top-11 z-30 flex w-[min(360px,calc(100vw-24px))] flex-col rounded-lg bg-bg text-text shadow-pop">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{t.notifications.title}</h2>
            <button
              type="button"
              onClick={markAll}
              disabled={!items?.some((n) => !n.read)}
              className="flex h-8 items-center gap-1 rounded-sm px-2 text-sm text-accent hover:bg-surface-hover disabled:text-text-disabled disabled:hover:bg-transparent"
            >
              <CheckCheck size={16} aria-hidden /> {t.notifications.readAll}
            </button>
          </div>
          {failed ? (
            <p role="alert" className="px-4 py-6 text-sm text-danger">{t.notifications.failed}</p>
          ) : items === null ? (
            <p role="status" className="px-4 py-6 text-sm text-text-muted">{t.notifications.loading}</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted">{t.notifications.empty}</p>
          ) : (
            <ul className="flex max-h-96 flex-col overflow-y-auto p-1" aria-label={t.notifications.title}>
              {items.map((n) => {
                const Icon = n.kind === "mention" ? AtSign : UserPlus;
                const line = n.kind === "mention" ? t.notifications.mention(n.actorName, n.boardName) : t.notifications.invite(n.actorName, n.boardName);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => go(n)}
                      className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-hover ${n.read ? "" : "bg-accent-subtle"}`}
                    >
                      <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.read ? "" : "font-semibold"}`}>
                          {line}
                          {!n.read && <span className="sr-only">, {t.notifications.unreadMark}</span>}
                        </span>
                        {n.excerpt && <span className="mt-0.5 block truncate text-sm text-text-muted">{n.excerpt}</span>}
                        <time dateTime={n.createdAt} className="mt-0.5 block text-xs text-text-muted">{fmt.format(new Date(n.createdAt))}</time>
                      </span>
                      {!n.read && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
