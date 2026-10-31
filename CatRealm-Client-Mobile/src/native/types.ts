export type NativeCallType = 'dm' | 'group';
export type NativeCallMediaType = 'audio' | 'video';

export interface NativeIncomingCall {
  callId: string;
  callType: NativeCallType;
  callerId: string;
  callerName: string;
  callerAvatar?: string | null;
  mediaType: NativeCallMediaType;
  conversationId?: string;
  groupChatId?: string;
}

export type NativeCallEndReason =
  | 'answered_elsewhere'
  | 'cancelled'
  | 'declined'
  | 'ended'
  | 'failed'
  | 'missed'
  | string;

export type NativeCallAction =
  | { type: 'displayed'; callId: string; occurredAt: number }
  | { type: 'answer'; callId: string; occurredAt: number }
  | { type: 'decline'; callId: string; occurredAt: number }
  | { type: 'end'; callId: string; reason?: NativeCallEndReason; occurredAt: number };
