import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuEntry =
  | { type?: 'item'; label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }
  | { type: 'heading'; label: string }
  | { type: 'separator' };

// Keeps the menu on screen when it is opened near the right or bottom edge.
function clampToViewport(el: HTMLDivElement | null) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  if (rect.right > window.innerWidth - margin) el.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`;
  if (rect.bottom > window.innerHeight - margin) el.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
}

/** A right-click menu at a screen position. Closes on a choice, outside click, Escape, scroll or resize. */
export function ContextMenu({ x, y, entries, onClose }: {
  x: number;
  y: number;
  entries: ContextMenuEntry[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      // Re-keyed by position so a second right-click reopens the menu at the new spot.
      key={`${x},${y}`}
      ref={(el) => { menuRef.current = el; clampToViewport(el); }}
      role="menu"
      className="fixed z-[9999] max-h-[calc(100vh-1rem)] w-52 max-w-[calc(100vw-2rem)] overflow-y-auto rounded border border-border bg-bg-elevated py-1 text-sm shadow-lg"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) => {
        if (entry.type === 'separator') return <div key={index} className="my-1 border-t border-border/60" />;
        if (entry.type === 'heading') {
          return <div key={index} className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{entry.label}</div>;
        }
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            onClick={() => { onClose(); entry.onSelect(); }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${entry.danger ? 'text-danger hover:bg-danger/15' : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'}`}
          >
            {entry.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{entry.icon}</span>}
            <span className="truncate">{entry.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
