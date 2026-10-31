import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useReactiveAvatarStore, REACTIVE_AVATAR_STATES } from '../../stores/reactiveAvatarStore';
import { useOverlayParticipants } from '../../lib/overlayParticipants';
import { isOfferShown, useReactiveShareStore } from '../../stores/reactiveShareStore';

/**
 * Invisible component that bridges voiceStore/callStore speaking state to the
 * Electron main process OBS overlay HTTP server via IPC. Renders nothing.
 */
export function OBSOverlayBridge() {
  const { inVoice, users } = useOverlayParticipants();

  // Overlay settings
  const obsOverlayEnabled = useSettingsStore((s) => s.obsOverlayEnabled);
  const obsOverlayPort = useSettingsStore((s) => s.obsOverlayPort);
  const obsOverlayShowNames = useSettingsStore((s) => s.obsOverlayShowNames);
  const obsOverlayAvatarSize = useSettingsStore((s) => s.obsOverlayAvatarSize);
  const obsOverlayGrayscaleWhenSilent = useSettingsStore((s) => s.obsOverlayGrayscaleWhenSilent);
  const obsOverlayHideWhenSilent = useSettingsStore((s) => s.obsOverlayHideWhenSilent);
  const obsOverlaySquareIcons = useSettingsStore((s) => s.obsOverlaySquareIcons);
  const reactiveAvatarsEnabled = useSettingsStore((s) => s.obsOverlayReactiveAvatars);
  const reactiveOverrides = useReactiveAvatarStore((s) => s.overrides);
  const myPack = useReactiveAvatarStore((s) => s.myPack);
  const offered = useReactiveShareStore((s) => s.offered);
  const received = useReactiveShareStore((s) => s.received);
  const approvals = useReactiveShareStore((s) => s.approvals);

  // Track previous enabled+port to detect changes that require server restart
  const prevEnabledRef = useRef<boolean | null>(null);
  const prevPortRef = useRef<number | null>(null);

  // Start/stop the overlay server when enabled or port changes
  useEffect(() => {
    if (!window.electron?.obsOverlaySetEnabled) return;
    const enabledChanged = prevEnabledRef.current !== obsOverlayEnabled;
    const portChanged = prevPortRef.current !== obsOverlayPort;
    if (!enabledChanged && !portChanged) return;
    prevEnabledRef.current = obsOverlayEnabled;
    prevPortRef.current = obsOverlayPort;
    window.electron.obsOverlaySetEnabled(obsOverlayEnabled, obsOverlayPort).catch(() => {});
  }, [obsOverlayEnabled, obsOverlayPort]);

  // Push state updates whenever voice/call state or settings change
  useEffect(() => {
    if (!obsOverlayEnabled) return;
    if (!window.electron?.obsOverlayUpdateState) return;

    const overlaySettings = {
      showNames: obsOverlayShowNames,
      avatarSize: obsOverlayAvatarSize,
      grayscaleWhenSilent: obsOverlayGrayscaleWhenSilent,
      hideWhenSilent: obsOverlayHideWhenSilent,
      squareIcons: obsOverlaySquareIcons,
    };

    const myPackSet = Object.keys(myPack.images).length > 0;
    const overlayUsers = users.map(({ key, isSelf, ...user }) => {
      // Your per-person override wins, then the pack they shared with you (friends
      // unless blocked, strangers once allowed), then for you, your own pack.
      const offer = offered[key];
      const shared = offer?.status === 'ready' && isOfferShown(key, offer, approvals) ? received[offer.hash] : undefined;
      const override = !reactiveAvatarsEnabled
        ? undefined
        : reactiveOverrides[key] ?? shared ?? (isSelf && myPackSet ? myPack : undefined);
      if (!override) return user;
      // Served by the overlay server itself, so paths are relative to the OBS page.
      const reactive: Record<string, string> = { motion: override.motion };
      for (const state of REACTIVE_AVATAR_STATES) {
        const imageId = override.images[state];
        if (imageId) reactive[state] = `/reactive/${imageId}`;
      }
      return { ...user, reactive };
    });

    window.electron.obsOverlayUpdateState({ inVoice, users: overlayUsers, settings: overlaySettings }).catch(() => {});
  }, [
    obsOverlayEnabled, inVoice, users, reactiveAvatarsEnabled, reactiveOverrides, myPack,
    offered, received, approvals,
    obsOverlayShowNames, obsOverlayAvatarSize, obsOverlayGrayscaleWhenSilent,
    obsOverlayHideWhenSilent, obsOverlaySquareIcons,
  ]);

  return null;
}
