import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Pressable } from '@/components/Pressable';
import { Text } from '@/components/Text';
import { useAuthStore } from '@/stores/authStore';
import { markAccountAppTourDone, markDeviceSeenAppTour, useAppTourStore } from '@/lib/appTour';
import { getTourAnchor } from '@/lib/tourAnchors';
import { TOUR_STEPS, type TourContext, type TourStep } from './tourSteps';
import { LanguageSelector } from '@/components/LanguageSelector';

type Rect = { x: number; y: number; width: number; height: number };

const YELLOW = '#FACC15';
const DIM = 'rgba(0, 0, 0, 0.62)';
const PAD = 6;
const GAP = 12;
const EDGE = 16;
// After a step navigates or waits on the user, the next anchor may still be mounting.
const ANCHOR_WAIT_MS = 1500;
const POLL_MS = 300;

function measure(name: string): Promise<Rect | null> {
  const anchor = getTourAnchor(name);
  if (!anchor) return Promise.resolve(null);
  return new Promise((resolve) => {
    anchor.view.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

async function waitForAnchor(name: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!(await measure(name))) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

export function AppTourOverlay() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const open = useAppTourStore((s) => s.open);
  const stop = useAppTourStore((s) => s.stop);
  const userId = useAuthStore((s) => s.user?.id);
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(160);
  const moving = useRef(false);
  const scrolledFor = useRef<number | null>(null);
  const ctx = useRef<TourContext>({ router, pathname });
  ctx.current = { router, pathname };

  const step: TourStep | undefined = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    if (userId) markDeviceSeenAppTour(userId);
    if (isCentral) markAccountAppTourDone();
    stop();
  }, [userId, isCentral, stop]);

  // Move to the next usable step in `dir`, running each candidate's setup first.
  const go = useCallback(async (dir: 1 | -1, from: number) => {
    if (moving.current) return;
    moving.current = true;
    try {
      let i = from + dir;
      while (i >= 0 && i < TOUR_STEPS.length) {
        const candidate = TOUR_STEPS[i];
        if (!candidate.when || candidate.when()) {
          candidate.onEnter?.(ctx.current);
          const previous = TOUR_STEPS[i - dir];
          const mayStillMount = !!candidate.onEnter || (dir === 1 && !!previous?.waitFor);
          if (!candidate.target || await waitForAnchor(candidate.target, mayStillMount ? ANCHOR_WAIT_MS : POLL_MS)) break;
        }
        i += dir;
      }
      if (i >= TOUR_STEPS.length) finish();
      else if (i >= 0) {
        setRect(null);
        setIndex(i);
      }
    } finally {
      moving.current = false;
    }
  }, [finish]);

  // Opening (or replaying) starts from the top.
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setRect(null);
    TOUR_STEPS[0].onEnter?.(ctx.current);
  }, [open]);

  // Follow the anchor as screens move, scroll it into view once, and notice
  // when the user has done what a waiting step asked.
  useEffect(() => {
    if (!open || !step) return;
    let alive = true;
    const tick = async () => {
      if (step.waitFor?.(ctx.current)) {
        void go(1, index);
        return;
      }
      if (!step.target) return;
      const next = await measure(step.target);
      if (!alive) return;
      const anchor = getTourAnchor(step.target);
      const offScreen = next && (next.y < 60 || next.y + next.height > screenH - cardHeight - 40);
      if (next && offScreen && anchor?.scrollIntoView && scrolledFor.current !== index) {
        scrolledFor.current = index;
        anchor.scrollIntoView(next.y);
      }
      setRect(next);
    };
    void tick();
    const poll = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [open, step, index, go, screenH, cardHeight]);

  if (!open || !step) return null;

  const hole = step.target && rect ? {
    x: rect.x - PAD,
    y: rect.y - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;
  // Waiting steps need the highlighted spot tappable; interactive ones, the whole screen.
  const blockHole = !step.waitFor && !step.interactive;
  const cardTop = !hole
    ? Math.max(EDGE, (screenH - cardHeight) / 2)
    : hole.y + hole.height + GAP + cardHeight <= screenH - EDGE
      ? hole.y + hole.height + GAP
      : Math.max(EDGE, hole.y - GAP - cardHeight);

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.root]}>
      {!step.interactive && (hole ? (
        <>
          <View style={[styles.dim, { top: 0, left: 0, right: 0, height: Math.max(0, hole.y) }]} />
          <View style={[styles.dim, { top: hole.y + hole.height, left: 0, right: 0, bottom: 0 }]} />
          <View style={[styles.dim, { top: hole.y, height: hole.height, left: 0, width: Math.max(0, hole.x) }]} />
          <View style={[styles.dim, { top: hole.y, height: hole.height, left: hole.x + hole.width, right: 0 }]} />
          {blockHole ? <View style={[styles.block, hole && { top: hole.y, left: hole.x, width: hole.width, height: hole.height }]} /> : null}
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} />
      ))}
      {hole ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.glow, { top: hole.y - 4, left: hole.x - 4, width: hole.width + 8, height: hole.height + 8 }]}
          />
          <View
            pointerEvents="none"
            style={[styles.ring, { top: hole.y, left: hole.x, width: hole.width, height: hole.height }]}
          />
        </>
      ) : null}
      <View
        onLayout={(e: LayoutChangeEvent) => setCardHeight(e.nativeEvent.layout.height)}
        style={[
          styles.card,
          { top: cardTop, left: EDGE, width: screenW - EDGE * 2, backgroundColor: theme.colors.bgElev1 },
        ]}
      >
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.bgElev3 }]}>
          <View style={[styles.progressFill, { width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }]} />
        </View>
        <Text variant="subtitle" style={{ marginTop: 12 }}>
          {t(`appTour.steps.${index}.title`, { defaultValue: step.title })}
        </Text>
        <Text variant="bodySmall" color={theme.colors.text2} style={{ marginTop: 6 }}>
          {t(`appTour.steps.${index}.body`, { defaultValue: step.body })}
        </Text>
        {index === 0 ? <LanguageSelector compact /> : null}
        <View style={styles.actions}>
          {!isLast ? (
            <Pressable haptic onPress={finish} style={styles.skip}>
              <Text variant="caption" color={theme.colors.text3}>{t('appTour.controls.skip')}</Text>
            </Pressable>
          ) : null}
          <View style={styles.actionsRight}>
            {index > 0 ? (
              <Pressable haptic onPress={() => void go(-1, index)} style={styles.button}>
                <Text variant="bodySmall" color={theme.colors.text2}>{t('appTour.controls.back')}</Text>
              </Pressable>
            ) : null}
            {step.laterLabel ? (
              <Pressable haptic onPress={() => void go(1, index)} style={[styles.button, { backgroundColor: theme.colors.bgElev3 }]}>
                <Text variant="bodySmall">{t('appTour.controls.later')}</Text>
              </Pressable>
            ) : null}
            {step.waitFor ? (
              <Text variant="caption" color={YELLOW}>{t('appTour.controls.waiting')}</Text>
            ) : (
              <Pressable
                haptic
                onPress={() => (isLast ? finish() : void go(1, index))}
                style={[styles.button, { backgroundColor: theme.colors.accent }]}
              >
                <Text variant="bodySmall" color={theme.colors.textOnAccent}>
                  {isLast || step.laterLabel ? t('appTour.controls.done') : t('appTour.controls.next')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 1000, elevation: 1000 },
  dim: { position: 'absolute', backgroundColor: DIM },
  block: { position: 'absolute' },
  ring: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: YELLOW,
  },
  // A soft outer border rather than a shadow: iOS can't shadow a hollow view cheaply.
  glow: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: 4,
    borderColor: 'rgba(250, 204, 21, 0.3)',
  },
  card: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.6)',
    padding: 16,
  },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: YELLOW },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  actionsRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },
  skip: { paddingVertical: 6, paddingRight: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
});
