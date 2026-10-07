"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, MessageCircle, RotateCcw, X } from "lucide-react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { CommentThread, Person } from "@/lib/data/types";
import type { Item } from "@/lib/board/model";
import { colorForUser } from "@/lib/board/palette";
import { createThread, listPeople, listThreads, replyToThread, setThreadResolved } from "@/app/actions";
import { t } from "@/lib/copy";
import type { Viewport } from "./viewport";

export type CommentDraft = { x: number; y: number; itemId: string | null };

const SIGNAL = "comments"; // stateless message: "comments changed, fetch again"

/** S09: comment pins over the canvas, threads, replies, resolve, @mentions. Comments live in the database, not in the board document. */
export function Comments(props: {
  boardId: string;
  userId: string;
  canComment: boolean;
  vp: Viewport;
  size: { w: number; h: number };
  lookup: (id: string) => Item | undefined;
  provider: HocuspocusProvider | null;
  draft: CommentDraft | null;
  onDraftDone: () => void;
}) {
  const { boardId, userId, canComment, vp, size, lookup, provider, draft, onDraftDone } = props;
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);

  const refresh = useCallback(() => listThreads(boardId).then(setThreads, () => {}), [boardId]);
  useEffect(() => void refresh(), [refresh]);
  // People change while the board is open (someone gets invited), so fetch them whenever a composer opens.
  const composing = Boolean(draft) || openId !== null;
  useEffect(() => {
    if (composing) listPeople(boardId).then(setPeople, () => {});
  }, [boardId, composing]);
  useEffect(() => {
    if (!provider) return;
    const onStateless = ({ payload }: { payload: string }) => payload === SIGNAL && void refresh();
    provider.on("stateless", onStateless);
    return () => void provider.off("stateless", onStateless);
  }, [provider, refresh]);
  // A click anywhere else on the board closes the open thread, like any popover.
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: PointerEvent) => !(e.target as HTMLElement).closest("[data-comment-ui]") && setOpenId(null);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [openId]);
  const changed = useCallback(async () => {
    await refresh();
    provider?.sendStateless(SIGNAL);
  }, [provider, refresh]);

  // Board position of a pin: pins on an item follow it; pins on deleted items are hidden.
  const place = (p: { x: number; y: number; itemId: string | null }) => {
    if (!p.itemId) return { x: p.x, y: p.y };
    const i = lookup(p.itemId);
    return i ? { x: i.x + p.x, y: i.y + p.y } : null;
  };
  const screen = (b: { x: number; y: number }) => ({ left: b.x * vp.scale + vp.x, top: b.y * vp.scale + vp.y });

  const visible = threads.filter((th) => showResolved || !th.resolved || th.id === openId);
  const open = threads.find((th) => th.id === openId) ?? null;
  const resolvedCount = threads.filter((th) => th.resolved).length;

  const popoverAt = (b: { x: number; y: number }) => {
    const s = screen(b);
    return { left: Math.max(8, Math.min(size.w - 328, s.left + 20)), top: Math.max(68, Math.min(size.h - 340, s.top - 10)) };
  };

  const draftAt = draft && place(draft);
  const openAt = open && place(open);

  return (
    <>
      {visible.map((th) => {
        const b = place(th);
        if (!b) return null;
        const first = th.comments[0];
        const color = colorForUser(th.createdBy);
        const s = screen(b);
        return (
          <button
            key={th.id}
            type="button"
            data-comment-ui
            aria-label={`${t.comments.pin(first?.authorName ?? "", first?.body ?? "")}${th.resolved ? `, ${t.comments.resolvedPin}` : ""}`}
            aria-expanded={openId === th.id}
            onClick={() => setOpenId(openId === th.id ? null : th.id)}
            className={`absolute flex h-8 min-w-8 -translate-y-full items-center justify-center rounded-full rounded-bl-none px-2 text-xs font-semibold shadow-pop ${th.resolved ? "opacity-60" : ""}`}
            style={{ left: s.left, top: s.top, background: color.fill, color: color.label }}
          >
            {th.resolved ? <Check size={14} aria-hidden /> : th.comments.length > 1 ? th.comments.length : (first?.authorName ?? "?").slice(0, 1).toUpperCase()}
          </button>
        );
      })}

      {resolvedCount > 0 && (
        <button
          type="button"
          aria-pressed={showResolved}
          onClick={() => setShowResolved((v) => !v)}
          className="absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 items-center gap-2 rounded-md bg-bg px-3 text-sm shadow-toolbar hover:bg-surface-hover"
        >
          <MessageCircle size={16} aria-hidden /> {showResolved ? t.comments.hideResolved : t.comments.showResolved} ({resolvedCount})
        </button>
      )}

      {draft && draftAt && (
        <div role="dialog" aria-label={t.comments.thread} className="absolute z-10 w-80 rounded-lg bg-bg p-3 shadow-pop" style={popoverAt(draftAt)}>
          <Composer
            people={people}
            userId={userId}
            placeholder={t.comments.placeholder}
            onCancel={onDraftDone}
            onSubmit={async (text, mentioned) => {
              const th = await createThread(boardId, draft, text, mentioned);
              onDraftDone();
              setOpenId(th.id);
              await changed();
            }}
          />
        </div>
      )}

      {open && openAt && !draft && (
        <div data-comment-ui role="dialog" aria-label={t.comments.thread} className="absolute z-10 flex w-80 flex-col gap-3 rounded-lg bg-bg p-3 shadow-pop" style={popoverAt(openAt)}>
          <div className="flex items-center justify-between gap-2">
            {canComment ? (
              <button
                type="button"
                onClick={async () => {
                  await setThreadResolved(open.id, !open.resolved);
                  if (!open.resolved) setOpenId(null);
                  await changed();
                }}
                className="flex h-8 items-center gap-1 rounded-sm px-2 text-sm font-medium hover:bg-surface-hover"
              >
                {open.resolved ? <RotateCcw size={14} aria-hidden /> : <Check size={14} aria-hidden />}
                {open.resolved ? t.comments.reopen : t.comments.resolve}
              </button>
            ) : (
              <span />
            )}
            <button type="button" aria-label={t.comments.close} onClick={() => setOpenId(null)} className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-surface-hover">
              <X size={16} aria-hidden />
            </button>
          </div>
          <ol className="flex max-h-64 flex-col gap-3 overflow-y-auto" aria-label={t.comments.thread}>
            {open.comments.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5">
                <p className="text-xs">
                  <span className="font-semibold">{c.authorName}</span>{" "}
                  <time dateTime={c.createdAt} className="text-text-muted">
                    {new Date(c.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </time>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  <Highlight text={c.body} names={people.map((p) => p.name).filter(Boolean)} />
                </p>
              </li>
            ))}
          </ol>
          {canComment ? (
            <Composer
              key={open.id}
              people={people}
              userId={userId}
              placeholder={t.comments.replyPlaceholder}
              onSubmit={async (text, mentioned) => {
                await replyToThread(open.id, text, mentioned, boardId);
                await changed();
              }}
            />
          ) : (
            <p className="text-xs text-text-muted">{t.comments.readOnly}</p>
          )}
        </div>
      )}
    </>
  );
}

function Highlight({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>;
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(@(?:${esc.join("|")}))`, "g"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-accent-subtle px-0.5 text-accent">{p}</mark> : p))}</>;
}

/** Text box with @mention suggestions from the people on the board. */
function Composer(props: { people: Person[]; userId: string; placeholder: string; onSubmit: (text: string, mentions: string[]) => Promise<void>; onCancel?: () => void }) {
  const { people, userId, placeholder, onSubmit, onCancel } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const picked = useRef(new Map<string, string>()); // name -> user id

  useEffect(() => ref.current?.focus(), []);

  const candidates = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.userId && p.userId !== userId && p.name.toLowerCase().startsWith(q)).slice(0, 6);
  }, [people, query, userId]);

  const track = (value: string, caret: number) => {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setQuery(m ? m[1] : null);
    setActive(0);
  };

  const pick = (p: Person) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${p.name} `);
    const next = before + text.slice(caret);
    picked.current.set(p.name, p.userId!);
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = () => {
    const clean = text.trim();
    if (!clean || pending) return;
    const mentions = [...picked.current].filter(([name]) => clean.includes(`@${name}`)).map(([, id]) => id);
    start(async () => {
      try {
        setError(false);
        await onSubmit(clean, mentions);
        setText("");
        picked.current.clear();
      } catch {
        setError(true);
      }
    });
  };

  return (
    <form
      className="relative flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={2}
        value={text}
        aria-label={placeholder}
        placeholder={placeholder}
        maxLength={5000}
        role="combobox"
        aria-expanded={candidates.length > 0}
        aria-controls="mention-list"
        aria-autocomplete="list"
        aria-activedescendant={candidates.length ? `mention-${candidates[active]?.userId}` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (candidates.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(candidates[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && onCancel) onCancel();
        }}
        className="resize-none rounded-md border border-border-input bg-bg px-2 py-1.5 text-sm"
      />
      {candidates.length > 0 && (
        <ul id="mention-list" role="listbox" aria-label={t.comments.mentionList} className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md bg-bg p-1 shadow-pop">
          {candidates.map((p, i) => (
            <li
              key={p.userId}
              id={`mention-${p.userId}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`cursor-pointer rounded-sm px-2 py-1 text-sm ${i === active ? "bg-accent-subtle" : ""}`}
            >
              {p.name} <span className="text-xs text-text-muted">{p.email}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {t.comments.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-8 rounded-sm px-3 text-sm hover:bg-surface-hover">
            {t.comments.cancel}
          </button>
        )}
        <button type="submit" disabled={!text.trim() || pending} className="h-8 rounded-sm bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60">
          {t.comments.post}
        </button>
      </div>
    </form>
  );
}
