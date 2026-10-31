import { useEffect, useMemo, useState } from 'react';
import { writeClipboardText } from '../../lib/clipboard';
import { useSettingsStore } from '../../stores/settingsStore';

type HoverSnapshot = {
  label: string;
  file: string | null;
  line: string | null;
  fallback: string;
  details: string[];
  copyText: string;
  x: number;
  y: number;
  rect: DOMRect;
};

function getDataset(el: Element): DOMStringMap | null {
  return el instanceof HTMLElement || el instanceof SVGElement ? el.dataset : null;
}

function formatFallback(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const rawClassName = typeof el.className === 'string'
    ? el.className
    : typeof el.getAttribute('class') === 'string'
      ? el.getAttribute('class') ?? ''
      : '';
  const className = rawClassName.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  return className ? `${tag}${id}.${className}` : `${tag}${id}`;
}

function getElementText(el: Element): string | null {
  const text = (
    el instanceof HTMLElement ? el.innerText : el.textContent || ''
  ).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// Dev builds: React components that render this element, outermost first, read
// from the fiber React attaches to DOM nodes. Production names are minified, so
// this is skipped there.
function getReactComponentChain(el: Element, limit = 5): string[] {
  if (!import.meta.env.DEV) return [];
  const fiberKey = Object.keys(el).find((key) => key.startsWith('__reactFiber$'));
  type Fiber = { type: unknown; return: Fiber | null };
  let fiber = fiberKey ? (el as unknown as Record<string, Fiber>)[fiberKey] : null;
  const names: string[] = [];
  while (fiber && names.length < limit) {
    const type = fiber.type as { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } } | null;
    const name = typeof type === 'function' || (type && typeof type === 'object')
      ? type.displayName || type.name || type.render?.name || type.type?.name
      : null;
    if (name && /^[A-Z]/.test(name) && names[0] !== name) names.unshift(name);
    fiber = fiber.return;
  }
  return names;
}

function buildDetails(target: Element, resolved: Element, named: Element | null) {
  const details: string[] = [];
  const insideName = named && named !== resolved ? getDataset(named)?.debugName : null;
  if (insideName) details.push(`Inside: ${insideName}`);
  const chain = getReactComponentChain(resolved);
  if (chain.length > 0) details.push(`React: ${chain.join(' › ')}`);
  details.push(`Element: ${formatFallback(resolved)}`);
  if (target !== resolved) details.push(`Hovered: ${formatFallback(target)}`);

  const ariaLabel = target.getAttribute('aria-label') || resolved.getAttribute('aria-label');
  const title = target.getAttribute('title') || resolved.getAttribute('title');
  const role = target.getAttribute('role') || resolved.getAttribute('role');
  const text = getElementText(target);

  if (ariaLabel) details.push(`Aria: ${ariaLabel}`);
  if (title) details.push(`Title: ${title}`);
  if (role) details.push(`Role: ${role}`);
  if (text) details.push(`Text: ${text}`);

  return details;
}

function resolveDebugTarget(target: EventTarget | null): HoverSnapshot | null {
  if (!(target instanceof Element)) return null;
  // Dev builds tag every element with its source (see debugSourceTags in
  // vite.config.ts), so this is normally the hovered element itself; hand-written
  // data-debug-name tags still give the friendliest label where present.
  const tagged = target.closest<HTMLElement | SVGElement>('[data-debug-name], [data-debug-file]');
  const resolved = tagged ?? target;
  const rect = resolved.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const named = resolved.closest<HTMLElement | SVGElement>('[data-debug-name]');
  const dataset = getDataset(resolved);
  const component = dataset?.debugComponent;
  const label = dataset?.debugName
    || (component ? `${component} › ${formatFallback(resolved)}` : formatFallback(resolved));
  const file = dataset?.debugFile || null;
  const line = dataset?.debugLine || null;
  const fallback = formatFallback(target);
  const details = buildDetails(target, resolved, named);
  const source = file ? `${file}${line ? `:${line}` : ''}` : null;
  const copyText = [
    `Name: ${label}`,
    source ? `Source: ${source}` : null,
    ...details,
  ].filter(Boolean).join('\n');

  return {
    label,
    file,
    line,
    fallback,
    details,
    copyText,
    x: 0,
    y: 0,
    rect,
  };
}

export function DebugHoverInspector() {
  const enabled = useSettingsStore((s) => s.debugUIHoverInspector);
  const [hovered, setHovered] = useState<HoverSnapshot | null>(null);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHovered(null);
      setCopyStatus(null);
      return;
    }

    let raf = 0;
    let copyTimer = 0;
    let lastTarget: EventTarget | null = null;
    let lastX = 0;
    let lastY = 0;

    const update = () => {
      raf = 0;
      const next = resolveDebugTarget(lastTarget);
      if (!next) {
        setHovered(null);
        return;
      }
      setHovered({
        ...next,
        x: lastX,
        y: lastY,
      });
    };

    const onMove = (event: MouseEvent) => {
      lastTarget = event.target;
      lastX = event.clientX;
      lastY = event.clientY;
      setCopyStatus(null);
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    const onLeave = () => {
      lastTarget = null;
      setHovered(null);
    };

    const onContextMenu = (event: MouseEvent) => {
      // Ctrl+right-click copies; a plain right-click keeps the app's own context menus.
      if (!event.ctrlKey) return;
      const next = resolveDebugTarget(event.target);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      void writeClipboardText(next.copyText).then((ok) => {
        setCopyStatus(ok ? 'copied' : 'failed');
        if (copyTimer) window.clearTimeout(copyTimer);
        copyTimer = window.setTimeout(() => setCopyStatus(null), 1200);
      });
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('mouseleave', onLeave, true);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('mouseleave', onLeave, true);
      window.removeEventListener('blur', onLeave);
      if (raf) window.cancelAnimationFrame(raf);
      if (copyTimer) window.clearTimeout(copyTimer);
    };
  }, [enabled]);

  const overlayStyle = useMemo(() => {
    if (!hovered) return null;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    const left = Math.min(hovered.x + 18, Math.max(12, viewportWidth - 360));
    const top = hovered.y + 18 > viewportHeight - 120
      ? Math.max(12, hovered.y - 88)
      : hovered.y + 18;
    return { left, top };
  }, [hovered]);

  if (!enabled || !hovered || !overlayStyle) return null;

  return (
    <>
      <div
        className="fixed z-[999999] pointer-events-none rounded-lg border border-cyan-300/90 shadow-[0_0_0_1px_rgba(34,211,238,0.45)]"
        style={{
          left: hovered.rect.left,
          top: hovered.rect.top,
          width: hovered.rect.width,
          height: hovered.rect.height,
          background: 'rgba(34, 211, 238, 0.08)',
        }}
      />
      <div
        className="fixed z-[1000000] pointer-events-none max-w-[340px] rounded-xl border border-cyan-300/80 bg-slate-950/92 px-3 py-2 text-[11px] text-cyan-50 shadow-2xl"
        style={overlayStyle}
      >
        <div className="font-semibold text-cyan-200">{hovered.label}</div>
        {hovered.file && (
          <div className="text-cyan-100/85">
            {hovered.file}{hovered.line ? `:${hovered.line}` : ''}
          </div>
        )}
        <div className="mt-1 space-y-0.5 text-cyan-50/70">
          {hovered.details.slice(0, 6).map((detail) => (
            <div key={detail}>{detail}</div>
          ))}
        </div>
        <div className="mt-1 text-cyan-200/80">
          {copyStatus === 'copied'
            ? 'Copied source data'
            : copyStatus === 'failed'
              ? 'Copy failed'
              : 'Ctrl + right-click to copy source data'}
        </div>
      </div>
    </>
  );
}
