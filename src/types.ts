export type ItemType =
  | 'note' | 'heading' | 'link' | 'todo' | 'table' | 'comment'
  | 'board' | 'column' | 'image' | 'video' | 'audio' | 'file';

export interface TodoEntry { id: string; text: string; done: boolean }
export interface CommentEntry { id: string; author: string; text: string; at: number }

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
  todos?: TodoEntry[];
  table?: string[][];
  boardId?: string;
  childIds?: string[];
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
  dash?: boolean;
  /** 1 thin, 2 medium, 3 thick. */
  weight?: number;
  /** Undefined = arrow at the end only. */
  arrow?: 'none' | 'end' | 'both';
}

export interface Board {
  id: string;
  title: string;
  parentId: string | null;
  projectId?: string | null;
  /** Canvas background preset key (see BACKGROUNDS in lib.ts). */
  background?: string | null;
  items: Record<string, Item>;
  connections: Record<string, Connection>;
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
}

export interface Project { id: string; name: string; color: string; createdAt: number }

export interface Patch {
  title?: string;
  background?: string | null;
  projectId?: string | null;
  upsertItems?: Item[];
  removeItems?: string[];
  upsertConnections?: Connection[];
  removeConnections?: string[];
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface PresenceUser { clientId: string; name: string }
