import { useEffect, useRef, useState } from 'react';

const PRESETS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120];
const clampSize = (n: number) => Math.max(6, Math.min(400, Math.round(n)));

/**
 * A text size box like the one in Google Docs: type any size, step with − / +, or pick a preset.
 * `onPick` gets a size in px; `onOpen` fires before a click changes anything.
 */
export function FontSizeBox({ value, onPick, onOpen, title = 'Text size' }: {
  value: number | null; onPick: (px: number) => void; onOpen?: () => void; title?: string;
}) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(value ? String(value) : ''), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0) onPick(clampSize(n));
    else setDraft(value ? String(value) : '');
  };
  const step = (dir: 1 | -1) => {
    const cur = value ?? 14;
    const next = dir > 0 ? PRESETS.find((p) => p > cur) ?? cur + 12 : [...PRESETS].reverse().find((p) => p < cur) ?? Math.max(6, cur - 2);
    onPick(clampSize(next));
  };

  return (
    <div className="font-size-box" ref={ref} title={title}>
      <button className="fs-step" title="Smaller" onMouseDown={(e) => { e.preventDefault(); onOpen?.(); step(-1); }}>−</button>
      <input
        value={draft}
        inputMode="numeric"
        aria-label={title}
        placeholder="–"
        onMouseDown={() => onOpen?.()}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(value ? String(value) : ''); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
        }}
        onBlur={commit}
      />
      <button className="fs-step" title="Bigger" onMouseDown={(e) => { e.preventDefault(); onOpen?.(); step(1); }}>+</button>
      <button className="fs-more" title="Sizes" onMouseDown={(e) => { e.preventDefault(); onOpen?.(); setOpen((o) => !o); }}>▾</button>
      {open && (
        <div className="fs-menu">
          {PRESETS.map((p) => (
            <button key={p} className={p === value ? 'is-on' : ''} onMouseDown={(e) => { e.preventDefault(); onPick(p); setOpen(false); }}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}
