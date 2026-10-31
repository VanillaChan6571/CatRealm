import type { ReactiveAvatarMotion, ReactiveAvatarState } from '../../../stores/reactiveAvatarStore';

/** i18n keys for reactive avatar states and motions, shared by the settings UIs. */
export const STATE_LABEL_KEYS: Record<ReactiveAvatarState, string> = {
  idle: 'settingsContent.reactiveStateIdle',
  speaking: 'settingsContent.reactiveStateSpeaking',
  muted: 'settingsContent.reactiveStateMuted',
  deafened: 'settingsContent.reactiveStateDeafened',
};

export const MOTION_LABEL_KEYS: Record<ReactiveAvatarMotion, string> = {
  none: 'settingsContent.reactiveMotionNone',
  bounce: 'settingsContent.reactiveMotionBounce',
  pop: 'settingsContent.reactiveMotionPop',
};
