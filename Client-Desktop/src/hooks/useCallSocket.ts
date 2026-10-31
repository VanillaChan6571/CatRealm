import { useEffect } from 'react';
import { getSocket } from '../lib/socket';
import { useAuthStore } from '../stores/authStore';
import { useCallStore, setCallSocket } from '../stores/callStore';
import { useDMStore } from '../stores/dmStore';
import { AUTH_BASE, createAuthenticatedApi } from '../lib/authApi';

/**
 * Hook to manage Socket.io call event handlers
 * Registers listeners for call-related events (call:*, gc:call:*)
 * Only active for central accounts
 */
export function useCallSocket() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const isCentral = user?.accountType === 'central';

  useEffect(() => {
    // Only set up call handlers for central accounts
    if (!isCentral || !token || !user) {
      return;
    }

    const authServerUrl = AUTH_BASE;
    const socket = getSocket(authServerUrl);

    // If socket doesn't exist, wait for DM socket to create it
    if (!socket) {
      console.warn('[Call Socket] Socket not available yet');
      return;
    }

    // Set socket reference in call store
    setCallSocket(socket);

    console.log('[Call Socket] Registering call event handlers');

    let recoveringActiveCalls = false;
    let lastRecoverAt = 0;
    const recoverActiveCalls = async () => {
      const now = Date.now();
      if (recoveringActiveCalls) return;
      if (now - lastRecoverAt < 1500) return;
      const currentState = useCallStore.getState();
      if (currentState.activeDMCall || currentState.activeGroupCall) return;
      recoveringActiveCalls = true;
      lastRecoverAt = now;
      try {
        const api = createAuthenticatedApi();
        const res = await api.get('/api/calls/active');
        const activeCalls = Array.isArray(res.data?.activeCalls) ? res.data.activeCalls : [];
        if (activeCalls.length === 0) return;

        const groupCall = activeCalls.find((call: any) => call?.callType === 'group' && call?.status === 'active');
        if (groupCall?.callId && groupCall?.groupChatId) {
          await useCallStore.getState().joinGroupCall({
            callId: String(groupCall.callId),
            groupChatId: String(groupCall.groupChatId),
            groupName: String(groupCall.groupName || 'Group Chat'),
            groupAvatar: groupCall.groupAvatar ?? null,
            mediaType: groupCall.mediaType === 'video' ? 'video' : 'audio',
          });
          return;
        }

        const dmCall = activeCalls.find((call: any) => call?.callType === 'dm' && call?.status === 'active' && call?.selfJoined !== false);
        if (dmCall?.callId && dmCall?.conversationId && dmCall?.otherUser?.userId) {
          await useCallStore.getState().resumeDMCall({
            callId: String(dmCall.callId),
            conversationId: String(dmCall.conversationId),
            otherUserId: String(dmCall.otherUser.userId),
            otherUsername: String(dmCall.otherUser.displayName || dmCall.otherUser.username || 'Unknown'),
            otherAvatar: dmCall.otherUser.avatar ?? null,
            mediaType: dmCall.mediaType === 'video' ? 'video' : 'audio',
            otherJoined: dmCall.otherJoined,
          });
          return;
        }
        if (dmCall?.callId && dmCall?.conversationId && dmCall?.otherUser?.userId) {
          // This device held the call before reconnecting: rejoin through the server
          // so it re-claims the call and handleCallRejoined reconnects LiveKit media.
          useCallStore.setState({
            lastEndedDMCall: {
              callId: String(dmCall.callId),
              conversationId: String(dmCall.conversationId),
              otherUserId: String(dmCall.otherUser.userId),
              otherUsername: String(dmCall.otherUser.displayName || dmCall.otherUser.username || 'Unknown'),
              otherAvatar: dmCall.otherUser.avatar ?? null,
              mediaType: dmCall.mediaType === 'video' ? 'video' : 'audio',
              endedAt: Date.now(),
            },
          });
          await useCallStore.getState().rejoinCall();
        }
      } catch (error) {
        console.warn('[Call Socket] Failed to recover active call state:', error);
      } finally {
        recoveringActiveCalls = false;
      }
    };

    // ══════════════════════════════════════════════════════════════════════════
    // DM CALL EVENT HANDLERS
    // ══════════════════════════════════════════════════════════════════════════

    const onCallIncoming = (payload: {
      callId: string;
      conversationId: string;
      callerId: string;
      callerName: string;
      callerAvatar: string | null;
      mediaType: 'audio' | 'video';
      privacyMode: boolean;
    }) => {
      console.log('[Call Socket] Incoming call:', payload);
      useCallStore.getState().handleIncomingCall(payload);
    };

    const onCallInitiated = (payload: {
      callId: string;
      conversationId: string;
      mediaType: 'audio' | 'video';
      privacyMode: boolean;
    }) => {
      console.log('[Call Socket] Call initiated:', payload);

      // Create active call state (caller side)
      // Get conversation from DM store
      const conversation = useDMStore.getState().conversations.find(
        (c) => c.id === payload.conversationId
      );

      if (!conversation) {
        console.error('[Call Socket] Conversation not found for call:', payload.conversationId);
        return;
      }

      // Set up active call state
      useCallStore.setState({
        activeDMCall: {
          callId: payload.callId,
          conversationId: payload.conversationId,
          otherUserId: conversation.otherUserId,
          otherUsername: conversation.otherDisplayName || conversation.otherUsername,
          otherAvatar: conversation.otherAvatar,
          mediaType: payload.mediaType,
          privacyMode: payload.privacyMode,
          status: 'ringing',
          startedAt: Date.now(),
          isInitiator: true,
          otherMuted: false,
          otherDeafened: false,
          otherVideoEnabled: payload.mediaType === 'video',
          otherSharingScreen: false,
        },
      });
    };

    const onCallAccepted = (payload: { callId: string }) => {
      console.log('[Call Socket] Call accepted:', payload);
      useCallStore.getState().handleCallAccepted(payload);
    };

    const onCallDeclined = (payload: { callId: string; reason: string }) => {
      console.log('[Call Socket] Call declined:', payload);
      useCallStore.getState().handleCallDeclined(payload);
    };

    const onCallStateUpdate = (payload: {
      callId: string;
      fromUserId: string;
      state: {
        muted?: boolean;
        deafened?: boolean;
        videoEnabled?: boolean;
        sharingScreen?: boolean;
      };
    }) => {
      useCallStore.getState().handleRemoteCallStateUpdate(payload);
    };

    const onCallEnded = (payload: { callId: string; reason: string; duration?: number }) => {
      console.log('[Call Socket] Call ended:', payload);
      useCallStore.getState().handleCallEnded(payload);
    };

    const onCallParticipantLeft = (payload: { callId: string; userId: string; reason?: string }) => {
      console.log('[Call Socket] DM participant left:', payload);
      useCallStore.getState().handleDMParticipantLeft(payload);
    };

    const onCallParticipantJoined = (payload: { callId: string; userId: string }) => {
      console.log('[Call Socket] DM participant joined:', payload);
      void useCallStore.getState().handleDMParticipantJoined(payload);
    };

    const onCallBusy = (payload: { conversationId: string }) => {
      console.log('[Call Socket] User is busy:', payload);
      useCallStore.getState().handleCallBusy(payload);
    };

    const onCallError = (payload: { error: string }) => {
      console.error('[Call Socket] Error:', payload);
      useCallStore.getState().handleCallError(payload);
    };

    const onCallRejoined = (payload: { callId: string; otherJoined?: boolean }) => {
      console.log('[Call Socket] Rejoined call:', payload);
      void useCallStore.getState().handleCallRejoined(payload);
    };

    const onCallHandledElsewhere = (payload: { callId: string; reason?: string }) => {
      useCallStore.getState().handleCallHandledElsewhere(payload);
    };

    const onCallMovedDevice = (payload: { callId: string }) => {
      useCallStore.getState().handleCallMovedDevice(payload);
    };

    const onCallRejoinError = (payload: { callId: string; reason: string }) => {
      console.log('[Call Socket] Rejoin failed:', payload.reason);
      // Other user is gone — dismiss the rejoin offer
      useCallStore.getState().clearLastEndedCall();
    };

    const onConnect = () => {
      void recoverActiveCalls();
    };

    const onReconnect = () => {
      void recoverActiveCalls();
    };

    // ══════════════════════════════════════════════════════════════════════════
    // GROUP CALL EVENT HANDLERS
    // ══════════════════════════════════════════════════════════════════════════

    const onGroupCallStarted = (payload: {
      callId: string;
      groupChatId: string;
      initiatorId: string;
      initiatorName: string;
      mediaType: 'audio' | 'video';
    }) => {
      console.log('[Call Socket] Group call started:', payload);
      useCallStore.getState().handleGroupCallStarted(payload);
    };

    const onGroupCallInitiated = (payload: {
      callId: string;
      groupChatId: string;
      mediaType: 'audio' | 'video';
    }) => {
      console.log('[Call Socket] Group call initiated:', payload);
      useCallStore.getState().handleGroupCallInitiated(payload);
    };

    const onGroupCallJoined = (payload: {
      callId: string;
      participants: Array<{
        userId: string;
        username: string;
        displayName: string | null;
        avatar: string | null;
      }>;
    }) => {
      console.log('[Call Socket] Joined group call:', payload);
      void useCallStore.getState().handleGroupCallJoined(payload);
    };

    const onGroupCallParticipantJoined = (payload: {
      callId: string;
      userId: string;
      username: string;
      displayName: string | null;
      avatar: string | null;
    }) => {
      console.log('[Call Socket] Participant joined:', payload);
      useCallStore.getState().handleGroupCallParticipantJoined(payload);
    };

    const onGroupCallParticipantLeft = (payload: {
      callId: string;
      userId: string;
      duration: number;
    }) => {
      console.log('[Call Socket] Participant left:', payload);
      useCallStore.getState().handleGroupCallParticipantLeft(payload);
    };

    const onGroupCallStateUpdate = (payload: {
      callId: string;
      fromUserId: string;
      state: {
        muted?: boolean;
        deafened?: boolean;
        videoEnabled?: boolean;
        sharingScreen?: boolean;
      };
    }) => {
      useCallStore.getState().handleRemoteCallStateUpdate(payload);
    };

    const onGroupCallRoster = (payload: {
      callId: string;
      groupChatId: string;
      participants: Array<{ userId: string; username: string; displayName: string | null; avatar: string | null }>;
    }) => {
      useCallStore.getState().handleGroupCallRoster(payload);
    };

    const onGroupCallEnded = (payload: {
      callId: string;
      reason: string;
      duration?: number;
    }) => {
      console.log('[Call Socket] Group call ended:', payload);
      useCallStore.getState().handleGroupCallEnded(payload);
    };

    const onGroupCallError = (payload: { error: string }) => {
      console.error('[Call Socket] Group call error:', payload);
      useCallStore.getState().handleGroupCallError(payload);
    };

    // ══════════════════════════════════════════════════════════════════════════
    // REGISTER EVENT LISTENERS
    // ══════════════════════════════════════════════════════════════════════════

    // DM call events
    socket.on('connect', onConnect);
    socket.on('reconnect', onReconnect);
    socket.on('call:incoming', onCallIncoming);
    socket.on('call:initiated', onCallInitiated);
    socket.on('call:accepted', onCallAccepted);
    socket.on('call:declined', onCallDeclined);
    socket.on('call:state:update', onCallStateUpdate);
    socket.on('call:participant-left', onCallParticipantLeft);
    socket.on('call:participant-joined', onCallParticipantJoined);
    socket.on('call:ended', onCallEnded);
    socket.on('call:busy', onCallBusy);
    socket.on('call:error', onCallError);
    socket.on('call:rejoined', onCallRejoined);
    socket.on('call:rejoin:error', onCallRejoinError);
    socket.on('call:handled-elsewhere', onCallHandledElsewhere);
    socket.on('call:moved-device', onCallMovedDevice);

    // Group call events
    socket.on('gc:call:started', onGroupCallStarted);
    socket.on('gc:call:initiated', onGroupCallInitiated);
    socket.on('gc:call:joined', onGroupCallJoined);
    socket.on('gc:call:participant-joined', onGroupCallParticipantJoined);
    socket.on('gc:call:participant-left', onGroupCallParticipantLeft);
    socket.on('gc:call:state:update', onGroupCallStateUpdate);
    socket.on('gc:call:ended', onGroupCallEnded);
    socket.on('gc:call:roster', onGroupCallRoster);
    socket.on('gc:call:error', onGroupCallError);

    if (socket.connected) {
      void recoverActiveCalls();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ══════════════════════════════════════════════════════════════════════════

    return () => {
      console.log('[Call Socket] Removing call event handlers');

      // DM call events
      socket.off('connect', onConnect);
      socket.off('reconnect', onReconnect);
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:initiated', onCallInitiated);
      socket.off('call:accepted', onCallAccepted);
      socket.off('call:declined', onCallDeclined);
      socket.off('call:state:update', onCallStateUpdate);
      socket.off('call:participant-left', onCallParticipantLeft);
      socket.off('call:participant-joined', onCallParticipantJoined);
      socket.off('call:ended', onCallEnded);
      socket.off('call:busy', onCallBusy);
      socket.off('call:error', onCallError);
      socket.off('call:rejoined', onCallRejoined);
      socket.off('call:rejoin:error', onCallRejoinError);
      socket.off('call:handled-elsewhere', onCallHandledElsewhere);
      socket.off('call:moved-device', onCallMovedDevice);

      // Group call events
      socket.off('gc:call:started', onGroupCallStarted);
      socket.off('gc:call:initiated', onGroupCallInitiated);
      socket.off('gc:call:joined', onGroupCallJoined);
      socket.off('gc:call:participant-joined', onGroupCallParticipantJoined);
      socket.off('gc:call:participant-left', onGroupCallParticipantLeft);
      socket.off('gc:call:state:update', onGroupCallStateUpdate);
      socket.off('gc:call:ended', onGroupCallEnded);
      socket.off('gc:call:roster', onGroupCallRoster);
      socket.off('gc:call:error', onGroupCallError);

      // Clear socket reference
      setCallSocket(null as any);
    };
  }, [isCentral, token, user?.id]);
}
