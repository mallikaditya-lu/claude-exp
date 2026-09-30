import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COLORS } from '../lib';
import type { Connection } from '../types';
import { IconTrash } from './icons';

const svg = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICON = {
  straight: svg(<path d="M4 20L20 4" />),
  elbow: svg(<path d="M4 18h6a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h6" />),
  curved: svg(<path d="M4 19c8 0 8-14 16-14" />),
  solid: svg(<path d="M4 12h16" />),
  dashed: svg(<path d="M4 12h4M10 12h4M16 12h4" />),
  none: svg(<path d="M4 12h16" />),
  end: svg(<><path d="M4 12h16" /><path d="M15 7l5 5-5 5" /></>),
  both: svg(<><path d="M4 12h16" /><path d="M15 7l5 5-5 5M9 7l-5 5 5 5" /></>),
  text: svg(<><path d="M5 6V4h14v2M12 4v16M9 20h6" /></>),
  weight: (w: number) => svg(<path d="M4 12h16" strokeWidth={w === 1 ? 1.4 : w === 2 ? 2.6 : 4.2} />),
};

function Dropdown({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button className={`dd-btn ${open ? 'is-open' : ''}`} title={label} onClick={() => setOpen((o) => !o)}>
        {button}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <div className="dd-menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Option({ active, title, onClick, children }: { active: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return <button className={`dd-opt ${active ? 'is-active' : ''}`} title={title} onClick={onClick}>{children}</button>;
}

interface Props {
  conn: Connection;
  update: (partial: Partial<Connection>, key?: string) => void;
  onDelete: () => void;
}

/** Floating toolbar for a selected line: colour, weight, label, dash, shape, arrowheads. */
export function ConnectorToolbar({ conn, update, onDelete }: Props) {
  const [labelOpen, setLabelOpen] = useState(Boolean(conn.label));
  const shape = conn.shape || 'curved';
  const arrow = conn.arrow || 'end';
  const weight = conn.weight || 1;
  const swatch = conn.color ? COLORS[conn.color]?.solid : 'var(--line)';

  return (
    <>
      <Dropdown label="Colour" button={<span className="dd-swatch" style={{ background: swatch }} />}>
        {(close) => (
          <div className="dd-swatches">
            {Object.entries(COLORS).map(([k, c]) => (
              <button
                key={k}
                className={`swatch ${(conn.color || 'default') === k ? 'is-active' : ''}`}
                title={k === 'default' ? 'Grey' : c.label}
                style={{ background: k === 'default' ? 'var(--line)' : c.solid }}
                onClick={() => { update({ color: k === 'default' ? undefined : k }); close(); }}
              />
            ))}
          </div>
        )}
      </Dropdown>
      <Dropdown label="Thickness" button={ICON.weight(weight)}>
        {(close) => [1, 2, 3].map((w) => (
          <Option key={w} active={weight === w} title={['Thin', 'Medium', 'Thick'][w - 1]} onClick={() => { update({ weight: w }); close(); }}>
            {ICON.weight(w)}
          </Option>
        ))}
      </Dropdown>
      <span className="sep" />
      <button className={`dd-btn ${labelOpen ? 'is-open' : ''}`} title="Add text" onClick={() => setLabelOpen((o) => !o)}>{ICON.text}</button>
      {labelOpen && (
        <input
          className="conn-input"
          autoFocus={!conn.label}
          placeholder="Label"
          value={conn.label || ''}
          onChange={(e) => update({ label: e.target.value }, `label-${conn.id}`)}
        />
      )}
      <span className="sep" />
      <Dropdown label="Line style" button={conn.dash ? ICON.dashed : ICON.solid}>
        {(close) => (
          <>
            <Option active={!conn.dash} title="Solid" onClick={() => { update({ dash: undefined }); close(); }}>{ICON.solid}</Option>
            <Option active={Boolean(conn.dash)} title="Dashed" onClick={() => { update({ dash: true }); close(); }}>{ICON.dashed}</Option>
          </>
        )}
      </Dropdown>
      <Dropdown label="Line type" button={ICON[shape]}>
        {(close) => (['elbow', 'curved', 'straight'] as const).map((s) => (
          <Option key={s} active={shape === s} title={{ elbow: 'Elbow', curved: 'Curved', straight: 'Straight' }[s]} onClick={() => { update({ shape: s, bend: undefined }); close(); }}>
            {ICON[s]}
          </Option>
        ))}
      </Dropdown>
      <Dropdown label="Arrows" button={ICON[arrow]}>
        {(close) => (['none', 'end', 'both'] as const).map((a) => (
          <Option key={a} active={arrow === a} title={{ none: 'No arrows', end: 'Arrow at end', both: 'Arrows at both ends' }[a]} onClick={() => { update({ arrow: a }); close(); }}>
            {ICON[a]}
          </Option>
        ))}
      </Dropdown>
      <span className="sep" />
      <button className="icon-btn danger" title="Delete line (⌫)" onClick={onDelete}><IconTrash size={16} /></button>
    </>
  );
}
