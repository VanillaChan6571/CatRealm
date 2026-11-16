// "Are you sure?" for destructive actions in Tracker and Board channels, shown with the
// app's own dialog. Native window.confirm() is silently refused by some hosts (embedded
// browser panes return false without showing anything), which made every delete a no-op.

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmText?: string;
  resolve: (confirmed: boolean) => void;
}

type Listener = (request: ConfirmRequest) => void;

let listener: Listener | null = null;

/** Called by ConfirmHost while it is mounted; returns the unsubscribe function. */
export function onConfirmRequest(next: Listener) {
  listener = next;
  return () => { if (listener === next) listener = null; };
}

/** Asks the user to confirm. Resolves false if they cancel or no host is on screen. */
export function confirmAction(options: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) resolve(false);
    else listener({ ...options, resolve });
  });
}
