export type ItemType =
  | 'note' | 'heading' | 'link' | 'todo' | 'table'
  | 'board' | 'column' | 'image' | 'video' | 'audio' | 'file';

export interface TodoEntry { id: string; text: string; done: boolean }
export interface CommentEntry {
  id: string;
  author: string;
  text: string;
  at: number;
  /** Set by the server for signed-in people and named link visitors. */
  authorEmail?: string;
  /** Written by someone who opened a share link (name and email typed in, not verified). */
  viaLink?: boolean;
  editedAt?: number;
}

/** A Figma-style comment pin: on a card (moves with it) or at a spot on the board. */
export interface Thread {
  id: string;
  /** Board position of the pin's point (also the fallback if its card is deleted). */
  x: number;
  y: number;
  itemId?: string | null;
  /** Offset from the card's top-left corner. */
  dx?: number | null;
  dy?: number | null;
  createdAt: number;
  resolved: { by: string; byEmail?: string | null; at: number } | null;
  comments: CommentEntry[];
}

export interface Item {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  w: number;
  z: number;
  /** Set when the card lives inside a column. */
  parentId?: string | null;
  color?: string;
  text?: string;
  title?: string;
  description?: string;
  url?: string;
  thumb?: string;
  siteName?: string;
  unfurled?: boolean;
  fileName?: string;
  size?: number;
  mime?: string;
  caption?: string;
  uploading?: boolean;
  /** Video that behaves like a GIF: plays muted on a loop, no controls (e.g. imported from Giphy). */
  loop?: boolean;
  /** Where an imported file came from. */
  source?: string;
  todos?: TodoEntry[];
  table?: string[][];
  /** Table column widths, as percentages of the table width. */
  colWidths?: number[];
  boardId?: string;
  childIds?: string[];
  /** Groups (type 'column'): columns in the grid. 0 = auto (fits the width); unset = 1 (older columns). */
  cols?: number;
  /** Text size in px for text cards (notes, headings, to-dos, tables). Unset = 14. */
  fontSize?: number;
  /** Text cards: heading levels (unset = normal text). The coloured 'heading' type is the Label style. */
  textStyle?: 'h1' | 'h2' | 'h3';
  comments?: CommentEntry[];
  createdBy?: string;
  createdAt?: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface Connection {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  /** Undefined = 'curved' (boards made before connector styles existed). */
  shape?: 'elbow' | 'curved' | 'straight';
  /** Fixed attachment sides; undefined picks the facing sides automatically. */
  fromSide?: Side;
  toSide?: Side;
  /** Elbow only: where the middle segment sits between the two ends (0–1, 0.5 = halfway). */
  bend?: number;
  /** Elbow only: how far each end's segment is slid along its card side, in board units (0 = centred). */
  fromShift?: number;
  toShift?: number;
  dash?: boolean;
  /** 1 thin, 2 medium, 3 thick. */
  weight?: number;
  /** Undefined = arrow at the end only. */
  arrow?: 'none' | 'end' | 'both';
}

/** A note in the board's Notes panel (editors' scratchpad, not on the canvas). */
export interface BoardNote { id: string; text: string; color?: string; author: string; authorEmail?: string | null; createdAt: number; updatedAt: number; editedBy?: string }

export interface Board {
  id: string;
  title: string;
  parentId: string | null;
  projectId?: string | null;
  /** What the current person can do on this board (sent by the server). */
  access?: Access;
  /** Canvas background preset key (see BACKGROUNDS in lib.ts). */
  background?: string | null;
  items: Record<string, Item>;
  connections: Record<string, Connection>;
  threads?: Record<string, Thread>;
  /** Only sent to people who can edit the board. */
  notes?: Record<string, BoardNote>;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface BoardSummary {
  id: string;
  title: string;
  parentId: string | null;
  projectId: string | null;
  background: string | null;
  updatedAt: number;
  createdAt: number;
  itemCount: number;
  cover: string | null;
  openComments?: number;
  /** What the current person can do on this board. */
  access?: Access;
}

export type Access = 'manage' | 'edit' | 'comment' | 'view';
export type MemberRole = 'editor' | 'commenter' | 'viewer';
export type GlobalRole = 'admin' | 'team' | 'guest';

/** `team`: on the core team (a team editor can also share and manage). */
export interface ProjectMember { email: string; role: MemberRole; invitedBy?: string; invitedAt?: number; name?: string | null; lastSeen?: number; team?: boolean }

export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  /** Chosen cover image (otherwise the project's board covers are shown). */
  cover?: string | null;
  /** What the current person can do in this project. */
  myLevel?: Access | null;
  /** Who made it (null for projects from before creators were recorded). */
  createdBy?: string | null;
  /** Only sent to people who manage the project. */
  members?: ProjectMember[];
}

export type LinkMode = 'off' | 'view' | 'comment';

export interface BoardSharing {
  boardId: string;
  project: { id: string; name: string } | null;
  /** Invited to this board directly. */
  members: ProjectMember[];
  /** Access that comes from a parent board or the project. */
  inherited: (ProjectMember & { from: { type: 'board' | 'project'; id: string; name: string } })[];
  link: { mode: LinkMode; requireIdentity: boolean; url: string | null };
  /** Parent boards whose share link also covers this board. */
  parentLinks: { id: string; title: string; mode: LinkMode }[];
  linkVisitors: { name: string; email: string; lastSeen: number }[];
  shareHostMissing: boolean;
}

export interface Patch {
  title?: string;
  background?: string | null;
  projectId?: string | null;
  cover?: string | null;
  upsertItems?: Item[];
  removeItems?: string[];
  upsertConnections?: Connection[];
  removeConnections?: string[];
  /** Comment threads only ever arrive from the server (they're saved through their own API). */
  upsertThreads?: Thread[];
  removeThreads?: string[];
  upsertNotes?: BoardNote[];
  removeNotes?: string[];
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface PresenceUser { clientId: string; name: string }
