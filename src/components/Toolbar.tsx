import type { ReactNode } from 'react';
import {
  IconBoard, IconColumn, IconComment, IconFolder, IconImage, IconLine, IconLink, IconNote, IconTable, IconTodo, IconUpload,
} from './icons';

export type Tool =
  | 'note' | 'heading' | 'link' | 'todo' | 'line' | 'board' | 'column' | 'table' | 'comment' | 'image' | 'upload';

export const TOOL_MIME = 'application/x-rb-tool';

export const TOOLS: { id: Tool; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'note', label: 'Text', icon: <IconNote />, hint: 'Text: paragraph, heading or label; change the style in the selection bar (N, or H for a heading)' },
  { id: 'link', label: 'Link', icon: <IconLink />, hint: 'Web link or embed: YouTube, Spotify, Figma… (L)' },
  { id: 'todo', label: 'To-do', icon: <IconTodo />, hint: 'Checklist (T)' },
  { id: 'line', label: 'Line', icon: <IconLine />, hint: 'Connect two cards (C)' },
  { id: 'board', label: 'Board', icon: <IconBoard />, hint: 'Nested board (B)' },
  { id: 'column', label: 'Group', icon: <IconColumn />, hint: 'Group: cards side by side in a resizable area (select cards and press ⌘G)' },
  { id: 'table', label: 'Table', icon: <IconTable />, hint: 'Table, e.g. a script or shot list' },
  { id: 'comment', label: 'Comment', icon: <IconComment />, hint: 'Comment: click anywhere to pin one (M)' },
  { id: 'image', label: 'Add image', icon: <IconImage />, hint: 'Upload images' },
  { id: 'upload', label: 'Upload', icon: <IconUpload />, hint: 'Upload video, audio, PDFs or any file' },
];

export function Toolbar({ onTool, lineMode, commentMode, assetsOpen, onAssets }: {
  onTool: (t: Tool) => void; lineMode: boolean; commentMode: boolean; assetsOpen: boolean; onAssets: () => void;
}) {
  return (
    <nav className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool ${(t.id === 'line' && lineMode) || (t.id === 'comment' && commentMode) ? 'is-active' : ''}`}
          title={t.hint}
          draggable={t.id !== 'line' && t.id !== 'image' && t.id !== 'upload'}
          onDragStart={(e) => {
            e.dataTransfer.setData(TOOL_MIME, t.id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onTool(t.id)}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
      <div className="tool-sep" />
      <button className={`tool ${assetsOpen ? 'is-active' : ''}`} title="Assets: every file added to this board" onClick={onAssets}>
        <span className="tool-icon"><IconFolder /></span>
        <span className="tool-label">Assets</span>
      </button>
    </nav>
  );
}
