import { useEffect } from 'react';
import type { ReactNode, TextareaHTMLAttributes } from 'react';

interface SharedComposerCoreProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  disabled?: boolean;
  maxLength?: number;
  rows?: number;
  autoGrowMaxHeight?: number;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  textareaClassName?: string;
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onPaste' | 'onKeyDown' | 'placeholder' | 'disabled' | 'maxLength' | 'rows'>;
  renderOverlay?: (text: string) => ReactNode;
}

export function SharedComposerCore({
  textareaRef,
  value,
  onChange,
  onPaste,
  onKeyDown,
  placeholder,
  disabled = false,
  maxLength = 2000,
  rows = 1,
  autoGrowMaxHeight = 376,
  leftSlot,
  rightSlot,
  textareaClassName = '',
  textareaProps,
  renderOverlay,
}: SharedComposerCoreProps) {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const nextHeight = Math.max(24, Math.min(el.scrollHeight, autoGrowMaxHeight));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > autoGrowMaxHeight ? 'auto' : 'hidden';
  }, [textareaRef, value, autoGrowMaxHeight, rows]);

  const overlayContent = renderOverlay && value ? renderOverlay(value) : null;

  const textareaEl = (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={`${overlayContent ? '' : 'flex-1 '}bg-transparent text-text-primary placeholder:text-text-muted resize-none px-4 py-2.5 text-sm leading-5 focus:outline-none no-scrollbar w-full${overlayContent ? ' selection:text-transparent' : ''}${textareaClassName ? ` ${textareaClassName}` : ''}`}
      style={overlayContent ? { color: 'transparent', caretColor: 'var(--color-text-primary)' } : undefined}
      spellCheck={overlayContent ? false : undefined}
      rows={rows}
      maxLength={maxLength}
      disabled={disabled}
      {...textareaProps}
    />
  );

  return (
    <>
      {leftSlot}
      {overlayContent ? (
        <div className="relative flex-1 min-w-0">
          <div
            aria-hidden="true"
            className="absolute inset-0 px-4 py-2.5 text-sm leading-5 text-text-primary whitespace-pre-wrap break-words pointer-events-none overflow-hidden select-none"
          >
            {overlayContent}
          </div>
          {textareaEl}
        </div>
      ) : (
        textareaEl
      )}
      {rightSlot}
    </>
  );
}
