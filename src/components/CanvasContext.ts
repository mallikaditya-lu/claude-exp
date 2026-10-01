import { createContext, useContext, type ReactNode } from 'react';
import type { BoardSummary, Item } from '../types';

export interface CanvasCtx {
  me: string;
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
