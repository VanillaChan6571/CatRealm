import { useRef, useState, useEffect, useImperativeHandle, forwardRef, type ReactNode } from 'react';

export interface DMComposerCoreHandle {
  focus(): void;
  clear(): void;
  getValue(): string;
  getCaretPlainOffset(): number;
  insertTextAtCaret(text: string, spaced?: boolean): void;
  insertEmoteAtCaret(token: string, url: string, name: string): void;
  replaceRangeWithText(startOffset: number, endOffset: number, text: string): void;
  replaceRangeWithEmote(startOffset: number, endOffset: number, token: string, url: string, name: string): void;
  /** Replace a range with a non-editable chip that shows `label` and sends `token`. */
  replaceRangeWithChip(startOffset: number, endOffset: number, token: string, label: string): void;
}

interface DMComposerCoreProps {
  onInput: (text: string, caretOffset: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFilePaste?: (files: FileList) => void;
  placeholder: string;
  disabled?: boolean;
  maxLength?: number;
  autoGrowMaxHeight?: number;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}

// ---------------------------------------------------------------------------
// Pure DOM helpers — no React state, safe to call outside render
// ---------------------------------------------------------------------------

/** Emote images and mention chips stand in for their `data-token` text. */
function tokenOf(node: Node): string | null {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  return (node as HTMLElement).dataset.token ?? null;
}

function serialize(container: HTMLElement): string {
  let text = '';
  for (const child of container.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? '';
    } else {
      text += tokenOf(child) ?? '';
    }
  }
  return text;
}

function readCaretPlainOffset(container: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);

  // Cursor at container level (between children)
  if (range.startContainer === container) {
    let offset = 0;
    for (let i = 0; i < range.startOffset && i < container.childNodes.length; i++) {
      const child = container.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        offset += child.textContent?.length ?? 0;
      } else {
        offset += tokenOf(child)?.length ?? 0;
      }
    }
    return offset;
  }

  // Cursor inside a text node
  let offset = 0;
  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i];
    if (child === range.startContainer) {
      return offset + range.startOffset;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      offset += child.textContent?.length ?? 0;
    } else {
      offset += tokenOf(child)?.length ?? 0;
    }
  }
  return offset;
}

/**
 * Converts a plain-text offset to a {node, offset} pair for use with Range API.
 */
function getNodeAtPlainOffset(
  container: HTMLElement,
  plainOffset: number
): { node: Node; offset: number } {
  let remaining = plainOffset;

  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE) {
      const len = child.textContent?.length ?? 0;
      if (remaining <= len) {
        return { node: child, offset: remaining };
      }
      remaining -= len;
    } else if (tokenOf(child) !== null) {
      const tokenLen = tokenOf(child)?.length ?? 0;
      if (remaining === 0) {
        return { node: container, offset: i };
      }
      if (remaining <= tokenLen) {
        return { node: container, offset: i + 1 };
      }
      remaining -= tokenLen;
    }
  }

  return { node: container, offset: container.childNodes.length };
}

function makeChip(token: string, label: string): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.textContent = label;
  chip.dataset.token = token;
  chip.contentEditable = 'false';
  chip.className = 'inline rounded px-0.5 font-medium text-purple-400 bg-purple-500/20 select-none';
  return chip;
}

function makeEmoteImg(token: string, url: string, name: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.alt = `:${name}:`;
  img.title = `:${name}:`;
  img.dataset.token = token;
  img.contentEditable = 'false';
  img.className = 'inline-block align-text-bottom w-5 h-5 pointer-events-none select-none';
  return img;
}

/**
 * Insert nodes at the current caret position and move caret after them.
 * Deletes any selection first.
 */
function doInsertNodes(container: HTMLElement, nodes: Node[]): void {
  if (nodes.length === 0) return;
  const sel = window.getSelection();
  if (!sel) return;

  let range: Range;
  if (sel.rangeCount > 0 && container.contains(sel.getRangeAt(0).startContainer)) {
    range = sel.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.setStart(container, container.childNodes.length);
    range.collapse(true);
  }

  for (const node of nodes) {
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Replace plain-text range [startOffset, endOffset) with the given nodes.
 * Moves caret after the last inserted node.
 */
function doReplaceRange(
  container: HTMLElement,
  startOffset: number,
  endOffset: number,
  nodes: Node[]
): void {
  const start = getNodeAtPlainOffset(container, startOffset);
  const end = getNodeAtPlainOffset(container, endOffset);

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  range.deleteContents();

  for (const node of nodes) {
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  }

  const sel = window.getSelection();
  if (sel && nodes.length > 0) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DMComposerCore = forwardRef<DMComposerCoreHandle, DMComposerCoreProps>(
  function DMComposerCore(
    {
      onInput,
      onKeyDown,
      onFilePaste,
      placeholder,
      disabled = false,
      maxLength = 2000,
      autoGrowMaxHeight = 376,
      leftSlot,
      rightSlot,
    },
    ref
  ) {
    const divRef = useRef<HTMLDivElement>(null);
    const [isEmpty, setIsEmpty] = useState(true);
    const [version, setVersion] = useState(0);
    // Snapshot of innerHTML before each edit — used to restore on maxLength overflow
    const lastInnerHTMLRef = useRef<string>('');
    const isComposingRef = useRef(false);

    // Auto-grow height — mirrors SharedComposerCore logic
    useEffect(() => {
      const el = divRef.current;
      if (!el) return;
      el.style.height = '0px';
      const sh = el.scrollHeight;
      const nextHeight = Math.max(40, Math.min(sh, autoGrowMaxHeight));
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = sh > autoGrowMaxHeight ? 'auto' : 'hidden';
    }, [isEmpty, version, autoGrowMaxHeight]);

    // Helper shared by all mutations that happen outside `handleInput`
    const afterMutation = (el: HTMLDivElement) => {
      const value = serialize(el);
      lastInnerHTMLRef.current = el.innerHTML;
      setIsEmpty(value.length === 0);
      setVersion((v) => v + 1);
      onInput(value, readCaretPlainOffset(el));
    };

    useImperativeHandle(ref, () => ({
      focus() {
        const el = divRef.current;
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (sel) {
          const r = document.createRange();
          r.setStart(el, el.childNodes.length);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      },

      clear() {
        const el = divRef.current;
        if (!el) return;
        el.textContent = '';
        lastInnerHTMLRef.current = '';
        setIsEmpty(true);
        setVersion((v) => v + 1);
        // Notify the parent that the value is now empty. Without this the
        // parent's mirrored `content` state stays stale after a send — leaving
        // the live preview showing the old message and letting a bare Enter
        // re-send it.
        onInput('', 0);
      },

      getValue() {
        return divRef.current ? serialize(divRef.current) : '';
      },

      getCaretPlainOffset() {
        return divRef.current ? readCaretPlainOffset(divRef.current) : 0;
      },

      insertTextAtCaret(text: string, spaced = false) {
        const el = divRef.current;
        if (!el) return;
        let insertText = text;
        if (spaced) {
          const currentValue = serialize(el);
          const caretPos = readCaretPlainOffset(el);
          const before = currentValue.slice(0, caretPos);
          const after = currentValue.slice(caretPos);
          const padLeft = before.length > 0 && !/\s$/.test(before);
          const padRight = after.length > 0 && !/^\s/.test(after);
          insertText = `${padLeft ? ' ' : ''}${text}${padRight ? ' ' : ''}`;
        }
        doInsertNodes(el, [document.createTextNode(insertText)]);
        afterMutation(el);
      },

      insertEmoteAtCaret(token: string, url: string, name: string) {
        const el = divRef.current;
        if (!el) return;
        doInsertNodes(el, [makeEmoteImg(token, url, name)]);
        afterMutation(el);
      },

      replaceRangeWithText(startOffset: number, endOffset: number, text: string) {
        const el = divRef.current;
        if (!el) return;
        doReplaceRange(el, startOffset, endOffset, [document.createTextNode(text)]);
        afterMutation(el);
      },

      replaceRangeWithEmote(
        startOffset: number,
        endOffset: number,
        token: string,
        url: string,
        name: string
      ) {
        const el = divRef.current;
        if (!el) return;
        doReplaceRange(el, startOffset, endOffset, [makeEmoteImg(token, url, name)]);
        afterMutation(el);
      },

      replaceRangeWithChip(startOffset: number, endOffset: number, token: string, label: string) {
        const el = divRef.current;
        if (!el) return;
        doReplaceRange(el, startOffset, endOffset, [makeChip(token, label), document.createTextNode(' ')]);
        afterMutation(el);
      },
    }));

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Backspace: if caret is collapsed and immediately after an IMG, delete it atomically
      if (e.key === 'Backspace') {
        const el = divRef.current;
        if (el) {
          const sel = window.getSelection();
          if (sel?.isCollapsed && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            let prevSibling: Node | null = null;

            if (range.startContainer === el && range.startOffset > 0) {
              prevSibling = el.childNodes[range.startOffset - 1];
            } else if (
              range.startContainer.nodeType === Node.TEXT_NODE &&
              range.startOffset === 0 &&
              range.startContainer.parentNode === el
            ) {
              prevSibling = range.startContainer.previousSibling;
            }

            if (prevSibling && tokenOf(prevSibling) !== null) {
              e.preventDefault();
              prevSibling.parentNode?.removeChild(prevSibling);
              afterMutation(el);
              return;
            }
          }
        }
      }

      // Enter (no shift): prevent browser newline, bubble to parent for send
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onKeyDown?.(e);
        return;
      }

      // Shift+Enter: insert literal newline
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const el = divRef.current;
        if (el) {
          doInsertNodes(el, [document.createTextNode('\n')]);
          afterMutation(el);
        }
        return;
      }

      onKeyDown?.(e);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const clipboardData = e.nativeEvent.clipboardData;
      if (!clipboardData) return;

      if (clipboardData.files.length > 0) {
        onFilePaste?.(clipboardData.files);
        return;
      }

      const text = clipboardData.getData('text/plain');
      if (!text) return;
      const el = divRef.current;
      if (!el) return;

      // Honour maxLength: trim paste to available space
      const currentLen = serialize(el).length;
      const available = maxLength - currentLen;
      if (available <= 0) return;
      const trimmed = text.slice(0, available);

      doInsertNodes(el, [document.createTextNode(trimmed)]);
      afterMutation(el);
    };

    const handleInput = () => {
      if (isComposingRef.current) return;
      const el = divRef.current;
      if (!el) return;

      const value = serialize(el);

      // Enforce maxLength: restore previous DOM if exceeded
      if (value.length > maxLength) {
        el.innerHTML = lastInnerHTMLRef.current;
        // Restore caret to end
        const sel = window.getSelection();
        if (sel) {
          const r = document.createRange();
          r.setStart(el, el.childNodes.length);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        return;
      }

      lastInnerHTMLRef.current = el.innerHTML;
      setIsEmpty(value.length === 0);
      setVersion((v) => v + 1);
      onInput(value, readCaretPlainOffset(el));
    };

    const handleCompositionStart = () => { isComposingRef.current = true; };
    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      handleInput();
    };

    return (
      <>
        {leftSlot}
        <div
          ref={divRef}
          contentEditable={disabled ? 'false' : 'true'}
          suppressContentEditableWarning
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onInput={handleInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          data-placeholder={isEmpty ? placeholder : undefined}
          className={`relative flex-1 bg-transparent text-text-primary resize-none px-4 py-2.5 text-sm leading-5 focus:outline-none no-scrollbar w-full break-words whitespace-pre-wrap${isEmpty ? ' dm-composer-empty' : ''}`}
          style={{ minHeight: '40px' }}
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder}
          spellCheck={!disabled}
        />
        {rightSlot}
      </>
    );
  }
);
