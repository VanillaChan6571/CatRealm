function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Slides a view in from one side; used when swapping between a channel and one of its threads. */
export function slideIn(element: HTMLElement | null, from: 'left' | 'right') {
  if (!element || prefersReducedMotion() || typeof element.animate !== 'function') return;
  element.animate(
    [{ opacity: 0, transform: `translateX(${from === 'right' ? 28 : -28}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 190, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}
