import Link from "next/link";
import { redirect } from "next/navigation";
import { data, LINK_SECRET } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { BoardClient } from "@/components/board/BoardClient";
import { checkEditorSeat } from "@/lib/billing/limits";
import { t } from "@/lib/copy";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const UUID = /^[0-9a-f-]{36}$/;

/** The link's secret from ?k=, when it looks like one. */
async function linkSecret(searchParams: Props["searchParams"]): Promise<string | null> {
  const k = (await searchParams).k;
  return typeof k === "string" && LINK_SECRET.test(k) ? k : null;
}

export async function generateMetadata({ params, searchParams }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: t.board.titleFallback };
  // Only people with access learn the board's name: members, or guests holding a valid link.
  const user = await currentUser();
  if (user) {
    const board = (await data.getRole(id, user.id)) ? await data.getBoard(id) : null;
    return { title: board?.name ?? t.board.titleFallback };
  }
  const k = await linkSecret(searchParams);
  const guest = k ? await data.guestBoard(id, k) : null;
  return { title: guest?.name ?? t.board.titleFallback, robots: { index: false } };
}

export default async function BoardPage({ params, searchParams }: Props) {
  const { id } = await params;
  const k = await linkSecret(searchParams);
  const here = `/board/${id}${k ? `?k=${k}` : ""}`;
  const user = await currentUser();
  const valid = UUID.test(id);

  if (!user) {
    // Not signed in: a valid guest link shows the board read-only; anything else asks to sign in,
    // without saying whether the board exists.
    const guest = valid && k ? await data.guestBoard(id, k) : null;
    if (!guest) redirect(`/login?next=${encodeURIComponent(here)}`);
    return <BoardClient board={{ id: guest.id, name: guest.name, linkAccess: "view", guestView: true }} role="viewer" user={{ id: "guest", name: t.guest.name }} guest={{ secret: k!, signIn: `/login?next=${encodeURIComponent(here)}` }} />;
  }

  const [board, member] = valid ? await Promise.all([data.getBoard(id), data.getRole(id, user.id)]) : [null, null];
  // Not on the board yet: a link with its secret, open to signed-in people, adds them. An edit link adds
  // a commenter instead once the owner's plan has no editor seats left.
  const capped = !member && k && board?.linkAccess === "edit" && !(await checkEditorSeat(data, id, { userId: user.id })).ok;
  const role = member ?? (board && k && board.linkAccess !== "private" ? await data.joinViaLink(user.id, id, { secret: k, ...(capped ? { maxRole: "commenter" as const } : {}) }) : null);

  if (!board || !role) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Эта доска недоступна</h1>
        <p className="text-text-muted">Её удалили, или у вас нет доступа. Попросите владельца пригласить вас.</p>
        <Link href="/" className="rounded-md bg-accent px-4 py-2 font-semibold text-on-accent">К моим доскам</Link>
      </main>
    );
  }
  // Joined by link: drop the secret from the address bar; they are on the board now.
  if (!member && k) redirect(`/board/${id}`);

  const [, unread] = await Promise.all([data.markOpened(user.id, id), data.unreadNotifications(user.id)]);
  return <BoardClient board={{ id: board.id, name: board.name, linkAccess: board.linkAccess, guestView: board.guestView }} role={role} user={{ id: user.id, name: user.name }} unread={unread} />;
}
