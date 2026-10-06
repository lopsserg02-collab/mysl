// Shapes match replica/schema.sql so the Supabase implementation can replace the local one
// without any screen code changing.

export type BoardRole = "owner" | "coowner" | "editor" | "commenter" | "viewer";
export type LinkAccess = "private" | "view" | "comment" | "edit";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Board {
  id: string;
  teamId: string;
  ownerId: string;
  name: string;
  description: string;
  linkAccess: LinkAccess;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BoardListItem extends Board {
  role: BoardRole;
  starred: boolean;
  lastOpenedAt: string | null;
}

export type ShareRole = "editor" | "commenter" | "viewer";

/** Someone on a board's people list: a member, or a pending invite (userId null). */
export interface Person {
  userId: string | null;
  name: string;
  email: string;
  role: BoardRole;
  pending: boolean;
}

export type BoardSort = "opened" | "modified" | "name";

export interface DataLayer {
  upsertUserByEmail(email: string, name: string): Promise<User>;
  getUser(id: string): Promise<User | null>;
  listBoards(userId: string, opts?: { q?: string; sort?: BoardSort; starredOnly?: boolean; trashed?: boolean }): Promise<BoardListItem[]>;
  createBoard(userId: string, name?: string): Promise<Board>;
  getBoard(boardId: string): Promise<Board | null>;
  getRole(boardId: string, userId: string): Promise<BoardRole | null>;
  renameBoard(userId: string, boardId: string, name: string): Promise<Board>;
  setStarred(userId: string, boardId: string, starred: boolean): Promise<void>;
  markOpened(userId: string, boardId: string): Promise<void>;
  trashBoard(userId: string, boardId: string): Promise<void>;
  restoreBoard(userId: string, boardId: string): Promise<void>;
  touchBoard(boardId: string): Promise<void>;
  // Sharing: only owners and co-owners change access; anyone on the board sees the people list.
  listPeople(userId: string, boardId: string): Promise<Person[]>;
  shareBoard(userId: string, boardId: string, email: string, role: ShareRole): Promise<"added" | "invited">;
  setMemberRole(userId: string, boardId: string, memberId: string, role: ShareRole | null): Promise<void>;
  cancelInvite(userId: string, boardId: string, email: string): Promise<void>;
  setLinkAccess(userId: string, boardId: string, access: LinkAccess): Promise<void>;
  /** A signed-in person opening a board shared by link joins it with the link's role. */
  joinViaLink(userId: string, boardId: string): Promise<BoardRole | null>;
}

export const SHARE_ROLES: ShareRole[] = ["editor", "commenter", "viewer"];
export const linkRole = (a: LinkAccess): ShareRole | null => (a === "edit" ? "editor" : a === "comment" ? "commenter" : a === "view" ? "viewer" : null);

export class AccessError extends Error {
  constructor(message = "You do not have access to this board") {
    super(message);
  }
}
