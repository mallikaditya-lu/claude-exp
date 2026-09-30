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

export interface Connection { id: string; from: string; to: string; label?: string; color?: string }

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
