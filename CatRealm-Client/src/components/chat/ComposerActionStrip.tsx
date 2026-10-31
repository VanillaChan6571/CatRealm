import type { ReactNode, RefObject } from 'react';
import { ComposerIconButton, type ComposerButtonAction } from './ComposerActionButtons';

interface ComposerActionStripLeftProps {
  uploadControl?: ReactNode;
  pickerRef: RefObject<HTMLDivElement | null>;
  pickerAction: ComposerButtonAction;
  pickerPanel?: ReactNode;
  pickerButtonClassName?: string;
}

export function ComposerActionStripLeft({
  uploadControl,
  pickerRef,
  pickerAction,
  pickerPanel,
  pickerButtonClassName = 'px-3 py-2.5 text-text-muted hover:text-accent disabled:opacity-40 transition-colors',
}: ComposerActionStripLeftProps) {
  return (
    <>
      {uploadControl}
      <div ref={pickerRef} className="relative">
        <ComposerIconButton action={pickerAction} className={pickerButtonClassName}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-4 8.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm8 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm-4 8c-2.62 0-4.83-1.66-5.67-4h11.34c-.84 2.34-3.05 4-5.67 4Z" />
          </svg>
        </ComposerIconButton>
        {pickerPanel}
      </div>
    </>
  );
}

