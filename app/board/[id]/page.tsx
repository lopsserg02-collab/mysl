import Link from "next/link";
import { data } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { BoardClient } from "@/components/board/BoardClient";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const board = /^[0-9a-f-]{36}$/.test(id) ? await data.getBoard(id) : null;
  return { title: board?.name ?? "Доска" };
}

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/board/${id}`);
  const valid = /^[0-9a-f-]{36}$/.test(id);
  const [board, role] = valid ? await Promise.all([data.getBoard(id), data.getRole(id, user.id)]) : [null, null];

  if (!board || !role) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Эта доска недоступна</h1>
        <p className="text-text-muted">Её удалили, или у вас нет доступа. Попросите владельца пригласить вас.</p>
        <Link href="/" className="rounded-md bg-accent px-4 py-2 font-semibold text-on-accent">К моим доскам</Link>
      </main>
    );
  }

  await data.markOpened(user.id, id);
  return <BoardClient board={{ id: board.id, name: board.name }} role={role} user={{ id: user.id, name: user.name }} />;
}
