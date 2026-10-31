import { createPortal } from 'react-dom';
import type { ContextMenuItem } from '../../messaging/chatlib/messageActionDefinitions';

const MENU_VIEWPORT_PAD = 8;

/** Opened at the cursor, the menu can run off the bottom/right edge; pull it back once measured. */
function clampMenuToViewport(el: HTMLDivElement | null) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const left = Math.max(MENU_VIEWPORT_PAD, Math.min(rect.left, window.innerWidth - rect.width - MENU_VIEWPORT_PAD));
  const top = Math.max(MENU_VIEWPORT_PAD, Math.min(rect.top, window.innerHeight - rect.height - MENU_VIEWPORT_PAD));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

type MessageContextMenuProps = {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
};

export function MessageContextMenu({ items, position, onClose }: MessageContextMenuProps) {
  if (items.length === 0) return null;

  // Portaled so a transformed/animated message row can't turn `fixed` into row-relative.
  return createPortal(
    <div
      ref={clampMenuToViewport}
      className="fixed z-50 bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-44 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-1rem)] overflow-y-auto"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => (
        <div key={item.key}>
        {item.section && item.section !== items[index - 1]?.section && (
          <div className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {item.section}
          </div>
        )}
        <button
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={
            item.isDanger
              ? 'w-full text-left px-3 py-1.5 text-fuchsia-300 hover:bg-bg-hover/60 hover:text-fuchsia-200'
              : 'w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
          }
        >
          {item.label}
        </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
