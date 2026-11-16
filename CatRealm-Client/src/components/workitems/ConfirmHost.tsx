import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { onConfirmRequest, type ConfirmRequest } from './confirmAction';

/**
 * Renders the dialog for confirmAction(). Mounted once per Tracker/Board channel view and
 * portalled to <body> so it sits above any open modal instead of inside its transformed panel.
 */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => onConfirmRequest((next) => {
    setRequest(next);
    setOpen(true);
  }), []);

  // An unanswered request counts as "no" if the view goes away.
  useEffect(() => () => request?.resolve(false), [request]);

  return createPortal(
    <div className="relative z-[80]">
      <ConfirmDialog
        open={open}
        title={request?.title ?? ''}
        message={request?.message ?? ''}
        confirmText={request?.confirmText ?? 'Delete'}
        onConfirm={() => request?.resolve(true)}
        // ConfirmDialog calls this after onConfirm too; a second resolve is ignored.
        onClose={() => { request?.resolve(false); setOpen(false); }}
      />
    </div>,
    document.body,
  );
}
