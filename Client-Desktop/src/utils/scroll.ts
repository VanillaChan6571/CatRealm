// Small scroll helpers shared by the message lists.

/** True when the OS asks for reduced motion. Safe in non-DOM/test contexts. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Scroll a container to its bottom.
 *
 * Pass `smooth: true` only for short hops where easing reads as polish — e.g. a
 * new message arriving while the user is already pinned to the bottom. For
 * channel switches / initial loads keep it instant (the default): smooth-
 * scrolling through a full channel of history looks bad and is slow. Smooth is
 * additionally suppressed when the OS requests reduced motion.
 */
export function scrollToBottom(
  el: HTMLElement | null,
  opts: { smooth?: boolean } = {},
): void {
  if (!el) return;
  if (opts.smooth && !prefersReducedMotion()) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  } else {
    el.scrollTop = el.scrollHeight;
  }
}
