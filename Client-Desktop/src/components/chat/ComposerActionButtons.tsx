import type { ChangeEventHandler, ReactNode, RefObject } from 'react';

export type ComposerButtonAction = {
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onClick?: () => void;
};

interface ComposerIconButtonProps {
  action: ComposerButtonAction;
  className?: string;
  type?: 'button' | 'submit';
  children: ReactNode;
}

export function ComposerIconButton({
  action,
  className = '',
  type = 'button',
  children,
}: ComposerIconButtonProps) {
  return (
    <button
      type={type}
      onClick={action.onClick}
      disabled={!!action.disabled}
      title={action.title}
      aria-label={action.ariaLabel}
      className={className}
    >
      {children}
    </button>
  );
}

interface ComposerSendButtonProps {
  action: ComposerButtonAction;
  ready?: boolean;
  submit?: boolean;
}

export function ComposerSendButton({
  action,
  ready = false,
  submit = false,
}: ComposerSendButtonProps) {
  return (
    <ComposerIconButton
      action={action}
      type={submit ? 'submit' : 'button'}
      className={`px-3 py-2.5 text-text-muted hover:text-accent disabled:opacity-30 transition active:scale-90 disabled:active:scale-100 ${
        ready ? 'send-ready' : ''
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
      </svg>
    </ComposerIconButton>
  );
}

interface ComposerFileButtonProps {
  inputRef: RefObject<HTMLInputElement | null>;
  action: ComposerButtonAction;
  onChange: ChangeEventHandler<HTMLInputElement>;
  accept?: string;
  multiple?: boolean;
  className?: string;
}

export function ComposerFileButton({
  inputRef,
  action,
  onChange,
  accept,
  multiple = false,
  className = 'px-3 py-2.5 text-text-muted hover:text-accent disabled:opacity-40 transition-colors',
}: ComposerFileButtonProps) {
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={!!action.disabled}
        onChange={onChange}
      />
      <ComposerIconButton
        action={{
          ...action,
          onClick: () => {
            if (action.disabled) return;
            inputRef.current?.click();
          },
        }}
        className={className}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.5 6.5a5 5 0 0 0-9.9 1.4A4.5 4.5 0 0 0 6.5 17H17a4 4 0 0 0 .5-10.5zM12 12l-3 3h2v4h2v-4h2l-3-3z" />
        </svg>
      </ComposerIconButton>
    </>
  );
}
