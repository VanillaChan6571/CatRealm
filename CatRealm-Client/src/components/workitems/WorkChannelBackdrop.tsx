import { buildVoiceBackgroundCss, getVoiceBackgroundAnimation } from '../../lib/voiceCallBackground';
import type { BoardBackground } from '../../types';
import { VoiceBgSceneLayer } from '../voice/VoiceBgSceneLayer';
import { resolveRealmImage } from './workItemUtils';

/**
 * The layer drawn behind a board's lists: a colour pattern (the same ones voice calls use,
 * optionally animated) or an image. Fills its nearest positioned ancestor, which must clip
 * overflow because the animated mesh pattern is drawn oversized.
 */
export function WorkChannelBackdrop({ background, serverUrl, defaultImagePositionX = 50 }: {
  background: BoardBackground | null;
  serverUrl: string | null;
  defaultImagePositionX?: number;
}) {
  if (!background) return null;
  if (background.kind === 'image') {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `url("${resolveRealmImage(background.image, serverUrl)}")`,
          backgroundSize: background.stretch ? '100% 100%' : background.fit ? 'contain' : 'cover',
          backgroundPosition: `${background.positionX ?? defaultImagePositionX}% ${background.positionY ?? 50}%`,
          backgroundRepeat: 'no-repeat',
        }}
      />
    );
  }
  const animation = background.animated
    ? getVoiceBackgroundAnimation(background.colors, background.pattern)
    : { className: '', style: {} };
  return (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${animation.className}`}
        style={{ background: buildVoiceBackgroundCss(background.colors, background.pattern), ...animation.style }}
      />
      {background.scene && (
        <VoiceBgSceneLayer scene={background.scene} colors={background.colors} animated={background.animated} />
      )}
    </>
  );
}
