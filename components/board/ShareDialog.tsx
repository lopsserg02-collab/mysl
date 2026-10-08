"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Link2, RefreshCw, UserPlus, X } from "lucide-react";
import type { BoardRole, LinkAccess, Person, ShareRole } from "@/lib/data/types";
import { cancelInvite, getShareSecret, listPeople, resetShareSecret, setGuestView, setLinkAccess, setMemberRole, shareBoard } from "@/app/actions";
import { t } from "@/lib/copy";

const SHARE_ROLES: ShareRole[] = ["editor", "commenter", "viewer"];
const LINK: LinkAccess[] = ["private", "view", "comment", "edit"];

/** S08: invite by email, link access, and the people on the board. Everyone sees it; only owners change it. */
export function ShareDialog(props: { boardId: string; role: BoardRole; userId: string; linkAccess: LinkAccess; guestView: boolean; open: boolean; onClose: () => void }) {
  const { boardId, userId, open, onClose } = props;
  const manage = props.role === "owner" || props.role === "coowner";
  const ref = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [link, setLink] = useState(props.linkAccess);
  const [guests, setGuests] = useState(props.guestView);
  // The link carries the board's secret: the id alone opens nothing. Fetched when the dialog opens.
  const [secret, setSecret] = useState<string | null>(null);
  const shareUrl = secret && typeof location !== "undefined" ? `${location.origin}/board/${boardId}?k=${secret}` : "";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [message, setMessage] = useState<{ text: string; error?: boolean; plans?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const refresh = () => listPeople(boardId).then(setPeople, () => setPeople([]));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setMessage(null);
      void refresh();
      getShareSecret(boardId).then(setSecret, () => setSecret(null));
    } else if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn();
        await refresh();
      } catch {
        setMessage({ text: t.share.errorGeneric, error: true });
      }
    });

  // A plan limit says so in words and links to the plans; nothing changes on the board.
  const limited = (res: unknown) => {
    const r = res as { ok?: boolean; limit?: string; max?: number } | undefined;
    if (r?.ok !== false || r.limit !== "editors") return false;
    setMessage({ text: t.limits.editors(r.max ?? 0), error: true, plans: true });
    return true;
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    run(async () => {
      const res = await shareBoard(boardId, address, role);
      if (limited(res)) return;
      if (!res.ok) return setMessage({ text: t.share.errorEmail, error: true });
      setMessage({ text: res.result === "added" ? t.share.added(address) : t.share.invited(address) });
      setEmail("");
    });
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="share-title"
      className="w-[min(480px,calc(100vw-32px))] rounded-lg bg-bg p-0 text-text shadow-pop backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-center justify-between">
          <h2 id="share-title" className="text-lg font-semibold">{t.share.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.share.close} className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-surface-hover">
            <X size={18} aria-hidden />
          </button>
        </div>

        {manage && (
          <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-medium">{t.share.email}</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.share.emailPlaceholder}
                className="h-10 rounded-md border border-border-input bg-bg px-3"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t.share.role}</span>
              <select aria-label={t.share.role} value={role} onChange={(e) => setRole(e.target.value as ShareRole)} className="h-10 rounded-md border border-border-input bg-bg px-2">
                {SHARE_ROLES.map((r) => (
                  <option key={r} value={r}>{t.share.roles[r]}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={pending || !email.trim()} className="flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60">
              <UserPlus size={16} aria-hidden /> {t.share.invite}
            </button>
          </form>
        )}
        {message && (
          <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-danger" : "text-sm text-text-muted"}>
            {message.text}
            {message.plans && (
              <>
                {" "}
                <Link href="/pricing" className="font-medium text-accent underline underline-offset-2">{t.limits.seePlans}</Link>
              </>
            )}
          </p>
        )}

        <section aria-labelledby="link-title" className="flex flex-col gap-2">
          <h3 id="link-title" className="text-sm font-semibold">{t.share.linkTitle}</h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label={t.share.linkTitle}
              value={link}
              disabled={!manage || pending}
              onChange={(e) => {
                const next = e.target.value as LinkAccess;
                setLink(next);
                run(() => setLinkAccess(boardId, next));
              }}
              className="h-10 min-w-0 flex-1 rounded-md border border-border-input bg-bg px-2 disabled:opacity-70"
            >
              {LINK.map((a) => (
                <option key={a} value={a}>{t.share.link[a]}</option>
              ))}
            </select>
            <button type="button" onClick={copy} disabled={!shareUrl} className="flex h-10 items-center justify-center gap-2 rounded-md border border-border-input px-3 font-medium hover:bg-surface-hover disabled:opacity-60">
              <Link2 size={16} aria-hidden /> {copied ? t.share.copied : t.share.copy}
            </button>
          </div>
          {link !== "private" && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={guests}
                disabled={!manage || pending}
                onChange={(e) => {
                  const next = e.target.checked;
                  setGuests(next);
                  run(() => setGuestView(boardId, next));
                }}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>{t.share.guestView}</span>
            </label>
          )}
          {link !== "private" && <p className="text-xs text-text-muted">{guests ? t.share.guestNote : t.share.linkNote}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              aria-label={t.share.linkField}
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-md border border-border-input bg-surface px-2 text-xs text-text-muted"
            />
            {manage && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    setSecret(await resetShareSecret(boardId));
                    setMessage({ text: t.share.resetDone });
                  })
                }
                className="flex h-9 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-60"
              >
                <RefreshCw size={14} aria-hidden /> {t.share.reset}
              </button>
            )}
          </div>
        </section>

        <section aria-labelledby="people-title" className="flex flex-col gap-2">
          <h3 id="people-title" className="text-sm font-semibold">{t.share.people}</h3>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-busy={people === null}>
            {(people ?? []).map((p) => {
              const label = p.pending ? p.email : p.name;
              const editable = manage && p.role !== "owner" && p.userId !== userId;
              return (
                <li key={p.userId ?? `invite:${p.email}`} className="flex items-center gap-3 rounded-md px-1 py-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {label}
                      {p.userId === userId && <span className="font-normal text-text-muted"> ({t.share.you})</span>}
                    </p>
                    <p className="truncate text-xs text-text-muted">{p.pending ? t.share.pending : p.email}</p>
                  </div>
                  {editable ? (
                    <>
                      <select
                        aria-label={t.share.memberRole(label)}
                        value={p.role}
                        disabled={pending}
                        onChange={(e) => {
                          const next = e.target.value;
                          run(async () => {
                            setMessage(null);
                            limited(await (p.pending ? shareBoard(boardId, p.email, next) : setMemberRole(boardId, p.userId!, next)));
                          });
                        }}
                        className="h-8 rounded-sm border border-border-input bg-bg px-1 text-sm"
                      >
                        {SHARE_ROLES.map((r) => (
                          <option key={r} value={r}>{t.share.roles[r]}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`${p.pending ? t.share.cancelInvite : t.share.remove}: ${label}`}
                        onClick={() => run(() => (p.pending ? cancelInvite(boardId, p.email) : setMemberRole(boardId, p.userId!, null)))}
                        className="flex h-8 w-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface-hover"
                      >
                        <X size={16} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-text-muted">{t.share.roles[p.role]}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </dialog>
  );
}
