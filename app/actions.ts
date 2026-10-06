"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { data } from "@/lib/data";
import { requireUser } from "@/lib/session";

const id = z.string().uuid();

export async function createBoard() {
  const user = await requireUser();
  const board = await data.createBoard(user.id, "Без названия");
  redirect(`/board/${board.id}`);
}

export async function renameBoard(boardId: string, name: string) {
  const user = await requireUser();
  const clean = z.string().trim().min(1).max(60).parse(name);
  await data.renameBoard(user.id, id.parse(boardId), clean);
  revalidatePath("/");
}

export async function setStarred(boardId: string, starred: boolean) {
  const user = await requireUser();
  await data.setStarred(user.id, id.parse(boardId), z.boolean().parse(starred));
  revalidatePath("/");
}

export async function trashBoard(boardId: string) {
  const user = await requireUser();
  await data.trashBoard(user.id, id.parse(boardId));
  revalidatePath("/");
}

export async function restoreBoard(boardId: string) {
  const user = await requireUser();
  await data.restoreBoard(user.id, id.parse(boardId));
  revalidatePath("/");
}
