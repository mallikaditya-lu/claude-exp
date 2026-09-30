import type { ReactNode } from 'react';
import {
  IconBoard, IconColumn, IconComment, IconHeading, IconImage, IconLine, IconLink, IconNote, IconTable, IconTodo, IconUpload,
} from './icons';

export type Tool =
  | 'note' | 'heading' | 'link' | 'todo' | 'line' | 'board' | 'column' | 'table' | 'comment' | 'image' | 'upload';

export const TOOL_MIME = 'application/x-rb-tool';

const TOOLS: { id: Tool; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'note', label: 'Note', icon: <IconNote />, hint: 'Rich text note (N)' },
  { id: 'heading', label: 'Heading', icon: <IconHeading />, hint: 'Coloured section label (H)' },
  { id: 'link', label: 'Link', icon: <IconLink />, hint: 'Web link or embed: YouTube, Spotify, Figma… (L)' },
  { id: 'todo', label: 'To-do', icon: <IconTodo />, hint: 'Checklist (T)' },
  { id: 'line', label: 'Line', icon: <IconLine />, hint: 'Connect two cards (C)' },
  { id: 'board', label: 'Board', icon: <IconBoard />, hint: 'Nested board (B)' },
  { id: 'column', label: 'Column', icon: <IconColumn />, hint: 'Group cards in a column' },
  { id: 'table', label: 'Table', icon: <IconTable />, hint: 'Table, e.g. a script or shot list' },
  { id: 'comment', label: 'Comment', icon: <IconComment />, hint: 'Comment thread' },
  { id: 'image', label: 'Add image', icon: <IconImage />, hint: 'Upload images' },
  { id: 'upload', label: 'Upload', icon: <IconUpload />, hint: 'Upload video, audio, PDFs or any file' },
];

export function Toolbar({ onTool, lineMode }: { onTool: (t: Tool) => void; lineMode: boolean }) {
  return (
    <nav className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool ${t.id === 'line' && lineMode ? 'is-active' : ''}`}
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
    </nav>
  );
}
