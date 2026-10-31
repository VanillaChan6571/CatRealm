import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore, type AppLanguage } from '../../stores/settingsStore';
import { markAccountAppTourDone, markDeviceSeenAppTour, useAppTourStore } from '../../lib/appTour';
import { Button } from '../ui/Button';
import { TOUR_STEPS, type TourStep } from './tourSteps';

const CARD_WIDTH = 320;
const GAP = 14;
const PAD = 6;
const EDGE = 16;
// After a step clicks something or waits on the user, the next anchor may
// still be mounting (the settings modal is lazy loaded).
const ANCHOR_WAIT_MS = 1500;
const RING = '0 0 0 2px rgb(250 204 21), 0 0 22px 4px rgba(250, 204, 21, 0.45)';
const DIM = '0 0 0 9999px rgba(0, 0, 0, 0.62)';
const LANGUAGE_OPTIONS: ReadonlyArray<{ id: AppLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
  { id: 'ja', label: '日本語' },
];

function findAnchor(name: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? el : null;
}

async function waitForAnchor(name: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!findAnchor(name)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return true;
}

function cardPosition(rect: DOMRect | null, cardHeight: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { left: (vw - CARD_WIDTH) / 2, top: Math.max(EDGE, (vh - cardHeight) / 2) };
  const clampLeft = (x: number) => Math.min(Math.max(EDGE, x), vw - CARD_WIDTH - EDGE);
  const clampTop = (y: number) => Math.min(Math.max(EDGE, y), vh - cardHeight - EDGE);
  if (rect.right + GAP + CARD_WIDTH <= vw - EDGE) return { left: rect.right + GAP, top: clampTop(rect.top) };
  if (rect.left - GAP - CARD_WIDTH >= EDGE) return { left: rect.left - GAP - CARD_WIDTH, top: clampTop(rect.top) };
  if (rect.bottom + GAP + cardHeight <= vh - EDGE) return { left: clampLeft(rect.left), top: rect.bottom + GAP };
  return { left: clampLeft(rect.left), top: clampTop(rect.top - GAP - cardHeight) };
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function AppTour() {
  const { t } = useTranslation();
  const open = useAppTourStore((s) => s.open);
  const stop = useAppTourStore((s) => s.stop);
  const userId = useAuthStore((s) => s.user?.id);
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [paused, setPaused] = useState(false);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(180);
  const moving = useRef(false);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIndex(0);
  }

  const step: TourStep | undefined = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    if (userId) markDeviceSeenAppTour(userId);
    if (isCentral) markAccountAppTourDone();
    stop();
  }, [userId, isCentral, stop]);

  // Move to the next step in `dir` whose anchor is on screen, skipping the
  // rest (a tab this account doesn't have, say).
  const go = useCallback(async (dir: 1 | -1) => {
    if (moving.current) return;
    moving.current = true;
    try {
      let i = index + dir;
      while (i >= 0 && i < TOUR_STEPS.length) {
        const candidate = TOUR_STEPS[i];
        const previous = TOUR_STEPS[i - dir];
        const mayStillMount = dir === 1 && !!previous && (!!previous.waitFor || typeof previous.onEnter === 'object');
        if (!candidate.target || await waitForAnchor(candidate.target, mayStillMount ? ANCHOR_WAIT_MS : 0)) break;
        i += dir;
      }
      if (i >= TOUR_STEPS.length) finish();
      else if (i >= 0) setIndex(i);
    } finally {
      moving.current = false;
    }
  }, [index, finish]);

  // Step side effects: navigate for the user, or clear the way.
  useEffect(() => {
    if (!open || !step?.onEnter) return;
    if (step.onEnter === 'closeModal') {
      if (useUIStore.getState().activeModal) useUIStore.getState().closeModal();
    } else {
      document.querySelector<HTMLElement>(`[data-tour="${step.onEnter.click}"]`)?.click();
    }
  }, [open, step]);

  // Steps the user completes themselves.
  useEffect(() => {
    if (!open || step?.waitFor !== 'settingsOpen') return;
    return useUIStore.subscribe((state, prev) => {
      if (state.activeModal === 'profileSettings' && prev.activeModal !== 'profileSettings') void go(1);
    });
  }, [open, step, go]);

  const measure = useCallback(() => {
    setPaused(!!document.querySelector('[data-tour-pause]'));
    setRect(step?.target ? findAnchor(step.target)?.getBoundingClientRect() ?? null : null);
    if (card) setCardHeight(card.offsetHeight);
  }, [step, card]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    const poll = window.setInterval(measure, 300); // the layout can shift under us
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.clearInterval(poll);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (isTyping(e.target)) return;
      else if ((e.key === 'ArrowRight' || e.key === 'Enter') && !step?.waitFor) void go(1);
      else if (e.key === 'ArrowLeft') void go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, paused, step, finish, go]);

  if (!open || !step || paused) return null;

  const hole = step.target ? rect : null;
  const { left, top } = cardPosition(hole, cardHeight);
  const box = hole && {
    left: hole.left - PAD,
    top: hole.top - PAD,
    width: hole.width + PAD * 2,
    height: hole.height + PAD * 2,
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] pointer-events-none" role="dialog" aria-modal={!step.interactive} aria-label={t('appTour.label')}>
      {!box && <div className="absolute inset-0 bg-black/60 pointer-events-auto" />}
      {box && (
        <div
          className="absolute rounded-lg transition-all duration-300 ease-out"
          style={{ ...box, boxShadow: step.interactive ? RING : `${RING}, ${DIM}` }}
        />
      )}
      {/* Block the app, except the highlighted spot when the user must click it. */}
      {box && !step.interactive && (step.waitFor ? (
        <>
          <div className="absolute inset-x-0 top-0 pointer-events-auto" style={{ height: Math.max(0, box.top) }} />
          <div className="absolute inset-x-0 bottom-0 pointer-events-auto" style={{ top: box.top + box.height }} />
          <div className="absolute left-0 pointer-events-auto" style={{ top: box.top, height: box.height, width: Math.max(0, box.left) }} />
          <div className="absolute right-0 pointer-events-auto" style={{ top: box.top, height: box.height, left: box.left + box.width }} />
        </>
      ) : (
        <div className="absolute inset-0 pointer-events-auto" />
      ))}
      <div
        ref={setCard}
        className="absolute rounded-xl border border-yellow-400/60 bg-bg-elevated shadow-2xl p-4 transition-all duration-300 ease-out pointer-events-auto"
        style={{ left, top, width: CARD_WIDTH }}
      >
        <div className="h-1 rounded-full bg-bg-input overflow-hidden" aria-hidden>
          <div
            className="h-full bg-yellow-400 transition-all duration-300"
            style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }}
          />
        </div>
        <h3 className="mt-3 text-base font-semibold text-text-primary">
          {t(`appTour.steps.${index}.title`, { defaultValue: step.title })}
        </h3>
        <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">
          {t(`appTour.steps.${index}.body`, { defaultValue: step.body })}
        </p>
        {index === 0 && (
          <label className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <span>{t('settings.languageTitle')}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as AppLanguage)}
              className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1.5 text-xs text-text-primary"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-4 flex items-center gap-2">
          {!isLast && (
            <button type="button" onClick={finish} className="text-xs text-text-muted hover:text-text-primary transition-colors">
              {t('appTour.controls.skip')}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {index > 0 && <Button size="sm" variant="ghost" onClick={() => void go(-1)}>{t('appTour.controls.back')}</Button>}
            {step.laterLabel && <Button size="sm" variant="secondary" onClick={() => void go(1)}>{t('appTour.controls.later')}</Button>}
            {step.waitFor ? (
              <span className="text-xs font-medium text-yellow-400">{t('appTour.controls.waiting')}</span>
            ) : (
              <Button size="sm" onClick={() => (isLast ? finish() : void go(1))} autoFocus>
                {isLast || step.laterLabel ? t('appTour.controls.done') : t('appTour.controls.next')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
