import { NativeEventEmitter, NativeModules } from 'react-native';
import type { NativeCallAction, NativeCallEndReason, NativeIncomingCall } from './types';
import { enqueuePendingNativeCallAction } from './pendingNativeCallActions';

type NativeCallBridgeModule = {
  reportIncomingCall?: (call: NativeIncomingCall) => Promise<void> | void;
  reportOutgoingCall?: (call: NativeIncomingCall) => Promise<void> | void;
  markCallConnected?: (callId: string) => Promise<void> | void;
  endCall?: (callId: string, reason?: NativeCallEndReason) => Promise<void> | void;
  dismissIncomingCall?: (callId: string) => Promise<void> | void;
  supportsNativeIncomingCalls?: () => boolean | Promise<boolean>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const module = NativeModules.NativeCallBridge as NativeCallBridgeModule | undefined;
const emitter = module ? new NativeEventEmitter(module as never) : null;
const ACTION_EVENT = 'nativeCallAction';
const VOIP_TOKEN_EVENT = 'voipTokenUpdated';

export const nativeCallBridge = {
  async supportsNativeIncomingCalls(): Promise<boolean> {
    try {
      return !!(await module?.supportsNativeIncomingCalls?.());
    } catch {
      return false;
    }
  },

  async reportIncomingCall(call: NativeIncomingCall) {
    await module?.reportIncomingCall?.(call);
  },

  async reportOutgoingCall(call: NativeIncomingCall) {
    await module?.reportOutgoingCall?.(call);
  },

  async markCallConnected(callId: string) {
    await module?.markCallConnected?.(callId);
  },

  async endCall(callId: string, reason?: NativeCallEndReason) {
    await module?.endCall?.(callId, reason);
  },

  async dismissIncomingCall(callId: string) {
    await module?.dismissIncomingCall?.(callId);
  },

  subscribe(onAction: (action: NativeCallAction) => void) {
    if (!emitter) return () => {};
    const subscription = emitter.addListener(ACTION_EVENT, async (action: NativeCallAction) => {
      if (!action || typeof action.callId !== 'string') return;
      const normalized = { ...action, occurredAt: action.occurredAt || Date.now() } as NativeCallAction;
      await enqueuePendingNativeCallAction(normalized);
      onAction(normalized);
    });
    return () => subscription.remove();
  },

  subscribeVoipToken(onToken: (token: string | null) => void) {
    if (!emitter) return () => {};
    const subscription = emitter.addListener(VOIP_TOKEN_EVENT, (payload?: { token?: string | null }) => {
      onToken(typeof payload?.token === 'string' ? payload.token : null);
    });
    return () => subscription.remove();
  },
};
