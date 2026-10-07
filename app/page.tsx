import Link from "next/link";
import { Plus, Search, Star, Trash2, LayoutGrid, LogOut } from "lucide-react";
import { data, type BoardSort } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { t } from "@/lib/copy";
import { createBoard } from "./actions";
import { signOut } from "./login/actions";
import { BoardCard } from "@/components/dashboard/BoardCard";
import { NotificationBell } from "@/components/NotificationBell";

export const metadata = { title: "Мои доски" };

type View = "all" | "starred" | "trash";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; view?: string }>;
}) {
  const user = await requireUser("/");
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const sort: BoardSort = sp.sort === "modified" || sp.sort === "name" ? sp.sort : "opened";
  const view: View = sp.view === "starred" || sp.view === "trash" ? sp.view : "all";
  const [boards, unread] = await Promise.all([
    data.listBoards(user.id, { q, sort, starredOnly: view === "starred", trashed: view === "trash" }),
    data.unreadNotifications(user.id),
  ]);

  const tab = (v: View, label: string, Icon: typeof Star) => (
    <Link
      href={v === "all" ? "/" : `/?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={`flex h-10 items-center gap-2 rounded-md px-3 hover:bg-surface-hover ${view === v ? "bg-surface-active font-semibold" : ""}`}
    >
      <Icon size={16} aria-hidden /> {label}
    </Link>
  );

  const emptyText = q ? t.dash.emptySearch(q) : view === "starred" ? t.dash.emptyStarred : view === "trash" ? t.dash.emptyTrash : t.dash.emptyBody;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <nav aria-label="Разделы" className="flex shrink-0 flex-row gap-1 border-b border-border bg-surface p-3 md:w-56 md:flex-col md:border-b-0 md:border-r">
        <div className="mb-2 hidden px-3 py-2 text-lg font-semibold md:block">{t.product}</div>
        {tab("all", t.dash.all, LayoutGrid)}
        {tab("starred", t.dash.starred, Star)}
        {tab("trash", t.dash.trash, Trash2)}
        <form action={signOut} className="ml-auto md:ml-0 md:mt-auto">
          <button className="flex h-10 items-center gap-2 rounded-md px-3 text-text-muted hover:bg-surface-hover">
            <LogOut size={16} aria-hidden /> <span className="hidden md:inline">{t.dash.signOut}</span>
            <span className="sr-only md:hidden">{t.dash.signOut}</span>
          </button>
        </form>
      </nav>

      <main className="flex-1 p-4 md:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-xl font-semibold">{t.dash.title}</h1>
          <form className="flex flex-wrap items-center gap-2" role="search">
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            <label className="relative">
              <span className="sr-only">{t.dash.search}</span>
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                name="q"
                defaultValue={q}
                placeholder={t.dash.search}
                className="h-10 w-56 rounded-md border border-border-input bg-bg pl-9 pr-3"
              />
            </label>
            <label>
              <span className="sr-only">Сортировка</span>
              <select name="sort" defaultValue={sort} className="h-10 rounded-md border border-border-input bg-bg px-2">
                <option value="opened">{t.dash.sortOpened}</option>
                <option value="modified">{t.dash.sortModified}</option>
                <option value="name">{t.dash.sortName}</option>
              </select>
            </label>
            <button className="h-10 rounded-md border border-border-input px-3 hover:bg-surface-hover">OK</button>
          </form>
          <NotificationBell initialUnread={unread} />
          {view !== "trash" && (
            <form action={createBoard}>
              <button className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover">
                <Plus size={18} aria-hidden /> {t.dash.newBoard}
              </button>
            </form>
          )}
        </div>

        {boards.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-lg font-semibold">{q || view !== "all" ? emptyText : t.dash.emptyTitle}</p>
            {!q && view === "all" && <p className="text-text-muted">{t.dash.emptyBody}</p>}
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {boards.map((b) => (
              <li key={b.id}>
                <BoardCard board={b} trashed={view === "trash"} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
