import { createContext, useContext, type ReactNode } from 'react';
import type { BoardSummary, Item } from '../types';

/** Something to watch in the side player. */
/** `post`: a social post (e.g. on X), shown full height rather than in a video frame. */
export interface PlayMedia { title: string; provider: string; url?: string; iframe?: string; video?: string; aspect?: number; post?: boolean }

export interface CanvasCtx {
  me: string;
  canEdit: boolean;
  /** Open a video in the player beside the board (when the page has one). */
  play?: (m: PlayMedia) => void;
  boardId: string;
  notify: (msg: string) => void;
  items: Record<string, Item>;
  boards: Record<string, BoardSummary>;
  uploadProgress: Record<string, number>;
  dropTarget: { col: string; index: number } | null;
  openBoard: (id: string) => void;
  renameBoard: (id: string, title: string) => void;
  renderChild: (item: Item) => ReactNode;
}

export const CanvasContext = createContext<CanvasCtx | null>(null);

export function useCanvas() {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error('useCanvas outside canvas');
  return ctx;
}

export interface CardProps {
  item: Item;
  selected: boolean;
  editing: boolean;
  /** Merge fields into this card. Calls sharing a `key` collapse into one undo step. */
  update: (partial: Partial<Item>, key?: string) => void;
  setEditing: (on: boolean) => void;
}
