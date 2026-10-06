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

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

/** A comment pin. With itemId, x/y are relative to that item's top-left and the pin moves with it. */
export interface CommentThread {
  id: string;
  itemId: string | null;
  x: number;
  y: number;
  resolved: boolean;
  createdBy: string;
  createdAt: string;
  comments: Comment[];
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
  // Comments (S09): anyone on the board reads them; commenters and up write. Mentions notify people on the board.
  listThreads(userId: string, boardId: string): Promise<CommentThread[]>;
  createThread(userId: string, boardId: string, at: { x: number; y: number; itemId?: string | null }, body: string, mentions?: string[]): Promise<CommentThread>;
  replyToThread(userId: string, threadId: string, body: string, mentions?: string[]): Promise<Comment>;
  setThreadResolved(userId: string, threadId: string, resolved: boolean): Promise<void>;
  /** How many unread mentions the user has, for the dashboard. */
  unreadMentions(userId: string): Promise<number>;
}

export const canComment = (r: BoardRole | null) => r === "owner" || r === "coowner" || r === "editor" || r === "commenter";

export const SHARE_ROLES: ShareRole[] = ["editor", "commenter", "viewer"];
export const linkRole = (a: LinkAccess): ShareRole | null => (a === "edit" ? "editor" : a === "comment" ? "commenter" : a === "view" ? "viewer" : null);

export class AccessError extends Error {
  constructor(message = "You do not have access to this board") {
    super(message);
  }
}
