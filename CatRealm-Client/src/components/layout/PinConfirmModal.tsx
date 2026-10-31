import { usePinnedStore, type PinnedItem } from '../../stores/pinnedStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';

function pinLabel(item: PinnedItem): string {
  if (item.type === 'channel') return `#${item.name}`;
  if (item.type === 'dm') return item.username;
  return item.name;
}

// Confirmation prompt for pin/unpin gestures. Driven by pinnedStore.pendingConfirm,
// which is only set when a gesture is performed without holding Shift. Always mounted
// at the app root so it works regardless of whether the taskbar itself is visible.
export function PinConfirmModal() {
  const pendingConfirm = usePinnedStore((s) => s.pendingConfirm);
  const confirmPendingPin = usePinnedStore((s) => s.confirmPendingPin);
  const cancelPendingPin = usePinnedStore((s) => s.cancelPendingPin);

  if (!pendingConfirm) return null;

  const label = pinLabel(pendingConfirm.item);
  const isPin = pendingConfirm.action === 'pin';

  return (
    <ConfirmDialog
      open
      onClose={cancelPendingPin}
      onConfirm={confirmPendingPin}
      title={isPin ? 'Pin to Taskbar' : 'Unpin from Taskbar'}
      message={(
        <>
          {isPin
            ? <>Pin <span className="font-semibold text-text-primary">{label}</span> to the bottom taskbar?</>
            : <>Unpin <span className="font-semibold text-text-primary">{label}</span> from the bottom taskbar?</>}
          <span className="block mt-2 text-xs text-text-muted">Tip: hold Shift while clicking to skip this confirmation.</span>
        </>
      )}
      confirmText={isPin ? 'Pin' : 'Unpin'}
      variant={isPin ? 'primary' : 'danger'}
    />
  );
}
