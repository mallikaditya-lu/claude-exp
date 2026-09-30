import { useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import { sanitize } from '../../lib';

interface EditableProps {
  value?: string;
  editing: boolean;
  onChange: (value: string) => void;
  onDone?: () => void;
  placeholder?: string;
  /** Plain text (headings) instead of rich HTML (notes). */
  plain?: boolean;
  className?: string;
}

/**
 * contentEditable that React never re-renders into while it has focus,
 * so the caret stays put while the card state updates underneath it.
 */
export function Editable({ value, editing, onChange, onDone, placeholder, plain, className = '' }: EditableProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    if (plain) {
      if (el.textContent !== (value || '')) el.textContent = value || '';
    } else {
      const html = sanitize(value);
      if (el.innerHTML !== html) el.innerHTML = html;
    }
  }, [value, plain]);

  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const isEmpty = !value || value === '<br>' || value === '<p><br></p>';

  return (
    <div
      ref={ref}
      className={`editable ${className} ${isEmpty ? 'is-empty' : ''}`}
      data-placeholder={placeholder}
      contentEditable={editing ? (plain ? 'plaintext-only' : true) : false}
      onInput={(e) => {
        const el = e.currentTarget;
        onChange(plain ? el.innerText.replace(/\n+$/, '') : el.innerHTML);
      }}
      onBlur={() => onDone?.()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (plain && e.key === 'Enter')) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        // Keep pasted content clean: plain text only.
        e.preventDefault();
        e.stopPropagation();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
    />
  );
}

/** Textarea that grows with its content. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  });
  return <textarea ref={ref} rows={1} {...props} />;
}
