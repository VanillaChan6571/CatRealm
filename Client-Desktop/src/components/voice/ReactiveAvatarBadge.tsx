import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { getApprovalKey, useReactiveShareStore } from '../../stores/reactiveShareStore';
import { getOverlayPersonKey } from '../../lib/overlayPersonKey';
import { ReactivePackPreviewModal } from './ReactivePackPreviewModal';

type BadgeState = 'pending' | 'approved' | 'blocked';

function badgeSrc(state: BadgeState, px: number) {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}badges/reactive-avatar/${state}-${px}.png`;
}

/**
 * Cat Lab — shown before a name in call rows when that person offers a reactive
 * avatar pack: gold = waiting for your approval, green = showing on your
 * overlay, red = blocked. Click to preview and allow / block. Only rendered
 * while the OBS overlay and Reactive Avatars are on.
 */
export function ReactiveAvatarBadge({ identity, name }: { identity: string; name: string }) {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.obsOverlayEnabled && s.obsOverlayReactiveAvatars);
  const personKey = useMediaStore((s) => getOverlayPersonKey(
    identity,
    s.activeSession?.context === 'voice' ? useVoiceStore.getState().voiceServerUrl : null,
  ));
  const offer = useReactiveShareStore((s) => s.offered[personKey]);
  const approval = useReactiveShareStore((s) => (offer ? s.approvals[getApprovalKey(personKey, offer)] : undefined));
  const [open, setOpen] = useState(false);
  if (!enabled || !offer) return null;

  const state: BadgeState = approval === 'blocked'
    ? 'blocked'
    : offer.kind === 'friend' || approval === 'allowed' ? 'approved' : 'pending';
  const label = t(`reactiveShare.badge.${state}`);

  const openPreview = (event: React.SyntheticEvent) => {
    // Rows are often buttons themselves (join / context menu); keep the click here.
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title={label}
        aria-label={label}
        onClick={openPreview}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openPreview(e);
        }}
        className="inline-flex shrink-0 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <img
          src={badgeSrc(state, 18)}
          srcSet={`${badgeSrc(state, 18)} 1x, ${badgeSrc(state, 36)} 2x, ${badgeSrc(state, 54)} 3x`}
          width={18}
          height={18}
          alt=""
          draggable={false}
        />
      </span>
      {open && <ReactivePackPreviewModal personKey={personKey} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
