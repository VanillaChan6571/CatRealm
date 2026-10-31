import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { updateVoiceInputDevice } from '../../../stores/voiceStore';
import { useVoiceStore } from '../../../stores/voiceStore';
import { useFriendStore } from '../../../stores/friendStore';
import { useCallStore } from '../../../stores/callStore';
import { useGroupChatStore } from '../../../stores/groupChatStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useKeybindStore } from '../../../stores/keybindStore';
import { KEYBIND_ACTIONS, formatKeyCombo } from '../../../lib/keybinds';
import { useUIStore } from '../../../stores/uiStore';
import { useTranslation } from 'react-i18next';
import { ScreenshareSettingsPanel } from '../ScreenshareSettingsPanel';

type VoiceTabProps = {
  nativeVoiceBackend: boolean;
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  loadingAudioInputs: boolean;
  audioError: string | null;
  voiceInputDeviceId: string | null;
  voiceOutputDeviceId: string | null;
  setVoiceOutputDeviceId: (id: string | null) => void;
  recordingTest: boolean;
  testCountdown: number | null;
  testDurationSec: number;
  setTestDurationSec: (n: number) => void;
  recordedUrl: string | null;
  testPlaying: boolean;
  testAudioRef: React.RefObject<HTMLAudioElement | null>;
  rnnoiseEnabled: boolean;
  setRnnoiseEnabled: (v: boolean) => void;
  noiseGateEnabled: boolean;
  setNoiseGateEnabled: (v: boolean) => void;
  noiseGateThreshold: number;
  setNoiseGateThreshold: (db: number) => void;
  refreshAudioInputs: () => void;
  runMicTest: () => void;
  toggleTestPlayback: () => void;
};

export function VoiceTab(props: VoiceTabProps) {
  const { t } = useTranslation();
  const {
    nativeVoiceBackend,
    audioInputs,
    audioOutputs,
    loadingAudioInputs,
    audioError,
    voiceInputDeviceId,
    voiceOutputDeviceId,
    setVoiceOutputDeviceId,
    recordingTest,
    testCountdown,
    testDurationSec,
    setTestDurationSec,
    recordedUrl,
    testPlaying,
    testAudioRef,
    rnnoiseEnabled,
    setRnnoiseEnabled,
    noiseGateEnabled,
    setNoiseGateEnabled,
    noiseGateThreshold,
    setNoiseGateThreshold,
    refreshAudioInputs,
    runMicTest,
    toggleTestPlayback,
  } = props;
  const adjustedUserVolumes = useVoiceStore((s) => s.peerVolumeByUser);
  const voiceUsers = useVoiceStore((s) => s.users);
  const setPeerVolume = useVoiceStore((s) => s.setPeerVolume);
  const clearPeerVolumes = useVoiceStore((s) => s.clearPeerVolumes);
  const voiceInputMode = useSettingsStore((s) => s.voiceInputMode);
  const setVoiceInputDeviceId = useSettingsStore((s) => s.setVoiceInputDeviceId);
  const setVoiceInputMode = useSettingsStore((s) => s.setVoiceInputMode);
  const voiceCallE2EEEnabled = useSettingsStore((s) => s.voiceCallE2EEEnabled);
  const setVoiceCallE2EEEnabled = useSettingsStore((s) => s.setVoiceCallE2EEEnabled);
  const reconnectToRealtimeChannels = useSettingsStore((s) => s.reconnectToRealtimeChannels);
  const setReconnectToRealtimeChannels = useSettingsStore((s) => s.setReconnectToRealtimeChannels);
  const keybinds = useKeybindStore((s) => s.bindings);
  const openModal = useUIStore((s) => s.openModal);
  const friends = useFriendStore((s) => s.friends);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const groupDetailsById = useGroupChatStore((s) => s.groupDetailsById);
  const groupMemberNamesById = Object.values(groupDetailsById).reduce<Record<string, string>>((acc, detail) => {
    detail.members.forEach((member) => {
      const label = (member.displayName || member.username || '').trim();
      if (!label) return;
      if (!acc[member.id]) acc[member.id] = label;
    });
    return acc;
  }, {});
  const resolveAdjustedUsername = (userId: string) => {
    const voiceName = (voiceUsers[userId]?.username || '').trim();
    if (voiceName) return voiceName;

    if (activeDMCall?.otherUserId === userId) {
      const dmName = (activeDMCall.otherUsername || '').trim();
      if (dmName) return dmName;
    }

    const groupParticipant = activeGroupCall?.participants.find((participant) => participant.userId === userId);
    const groupCallName = (groupParticipant?.displayName || groupParticipant?.username || '').trim();
    if (groupCallName) return groupCallName;

    const friendName = (friends.find((friend) => friend.id === userId)?.username || '').trim();
    if (friendName) return friendName;

    const groupMemberName = (groupMemberNamesById[userId] || '').trim();
    if (groupMemberName) return groupMemberName;

    return `Unknown (${userId.slice(0, 6)})`;
  };
  // Live input level meter for noise gate calibration.
  // Opens a separate mic stream while the gate settings are visible;
  // cleaned up automatically when the section collapses or the device changes.
  const [meterDb, setMeterDb] = useState<number>(-60);
  const meterActiveRef = useRef(false);

  useEffect(() => {
    if (!noiseGateEnabled) {
      setMeterDb(-60);
      return;
    }

    if (nativeVoiceBackend) {
      let destroyed = false;
      let timer: number | null = null;
      const poll = async () => {
        const result = await window.electron?.nativeVoiceMicrophoneLevel?.().catch(() => null);
        if (destroyed) return;
        if (result?.ok && typeof result.db === 'number') setMeterDb(Math.max(-60, result.db));
        timer = window.setTimeout(poll, 100);
      };
      void poll();
      return () => {
        destroyed = true;
        if (timer !== null) window.clearTimeout(timer);
        setMeterDb(-60);
      };
    }

    let destroyed = false;
    let animId: number | null = null;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        const constraint = voiceInputDeviceId ? { deviceId: { exact: voiceInputDeviceId } } : true;
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraint as MediaTrackConstraints, video: false });
        if (destroyed) { stream.getTracks().forEach((t) => t.stop()); return; }

        ctx = new AudioContext({ sampleRate: 48000 });
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        meterActiveRef.current = true;

        const tick = () => {
          if (destroyed) return;
          analyser.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          const rms = Math.sqrt(sumSq / buf.length);
          const db = rms > 1e-9 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
          setMeterDb(db);
          animId = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // Mic access denied — meter stays silent
      }
    })();

    return () => {
      destroyed = true;
      meterActiveRef.current = false;
      if (animId !== null) cancelAnimationFrame(animId);
      ctx?.close().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
      setMeterDb(-60);
    };
  }, [nativeVoiceBackend, noiseGateEnabled, voiceInputDeviceId]);

  const adjustedEntries = Object.entries(adjustedUserVolumes)
    .sort((a, b) => {
      const aName = resolveAdjustedUsername(a[0]);
      const bName = resolveAdjustedUsername(b[0]);
      return aName.localeCompare(bName);
    });

  const pushToTalkDefault = KEYBIND_ACTIONS.find((action) => action.id === 'voice_push_to_talk')?.defaultCombos[0] ?? null;
  const pushToTalkBinding = (keybinds.voice_push_to_talk ?? []).find((combo) => !!combo) ?? pushToTalkDefault;
  const pushToTalkBindingLabel = pushToTalkBinding ? formatKeyCombo(pushToTalkBinding).join(' + ') : t('settingsContent.unbound');

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.navVoice')}</h3>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.inputMode')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.inputModeDesc')}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setVoiceInputMode('voice_activity')}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                voiceInputMode === 'voice_activity'
                  ? 'border-emerald-400/70 bg-emerald-500/10 text-text-primary'
                  : 'border-border bg-bg-input/50 text-text-muted hover:bg-bg-input'
              }`}
            >
              <div className="text-sm font-medium">{t('settingsContent.voiceActivity')}</div>
              <div className="mt-1 text-xs text-text-muted">{t('settingsContent.voiceActivityDesc')}</div>
            </button>
            <button
              type="button"
              onClick={() => setVoiceInputMode('push_to_talk')}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                voiceInputMode === 'push_to_talk'
                  ? 'border-amber-400/70 bg-amber-500/10 text-text-primary'
                  : 'border-border bg-bg-input/50 text-text-muted hover:bg-bg-input'
              }`}
            >
              <div className="text-sm font-medium">{t('settingsContent.pushToTalk')}</div>
              <div className="mt-1 text-xs text-text-muted">{t('settingsContent.pushToTalkDesc')}</div>
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-bg-input/30 px-3 py-2">
            <div>
              <div className="text-xs font-medium text-text-primary">{t('settingsContent.pushToTalkKeybind')}</div>
              <div className="text-[11px] text-text-muted">{t('settingsContent.currentBind', { bind: pushToTalkBindingLabel })}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openModal('keybinds')}>
              {t('settingsContent.openKeybinds')}
            </Button>
          </div>
          <label className="flex items-start justify-between gap-4 rounded-lg border border-border/70 bg-bg-input/30 px-3 py-3">
            <div>
              <div className="text-sm font-medium text-text-primary">{t('settingsContent.reconnectRealtime')}</div>
              <div className="mt-1 text-xs text-text-muted">
                {t('settingsContent.reconnectRealtimeDesc')}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reconnectToRealtimeChannels}
              onClick={() => setReconnectToRealtimeChannels(!reconnectToRealtimeChannels)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                reconnectToRealtimeChannels ? 'bg-accent' : 'bg-bg-hover'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  reconnectToRealtimeChannels ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.microphone')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.microphoneDesc')}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={refreshAudioInputs} disabled={loadingAudioInputs}>
            {loadingAudioInputs ? t('common.loading') : t('common.refresh')}
          </Button>
        </div>
        {nativeVoiceBackend && (
          <p className="text-xs text-text-muted">
            Linux Sushi voice uses its native audio backend. Device changes apply immediately.
          </p>
        )}
        {audioError && <p className="text-xs text-danger">{audioError}</p>}
        <select
          value={voiceInputDeviceId ?? ''}
          onChange={(e) => {
            const deviceId = e.target.value || null;
            if (nativeVoiceBackend) {
              // Native IDs do not exist in navigator.mediaDevices. Persist the
              // choice directly and let the Rust backend switch the live ADM.
              setVoiceInputDeviceId(deviceId);
              void window.electron?.nativeVoiceSetInputDevice?.(deviceId);
            } else {
              void updateVoiceInputDevice(deviceId);
            }
          }}
          className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary"
        >
          <option value="">{t('settingsContent.defaultMicrophone')}</option>
          {audioInputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('settingsContent.microphoneFallback', { id: d.deviceId.slice(0, 6) })}
            </option>
          ))}
        </select>

        <div className="pt-2">
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.speaker')}</p>
          <p className="text-xs text-text-muted mb-2">{t('settingsContent.speakerDesc')}</p>
        </div>
        <select
          value={voiceOutputDeviceId ?? ''}
          onChange={(e) => {
            const deviceId = e.target.value || null;
            setVoiceOutputDeviceId(deviceId);
            if (nativeVoiceBackend) void window.electron?.nativeVoiceSetOutputDevice?.(deviceId);
          }}
          className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary"
        >
          <option value="">{t('settingsContent.defaultOutput')}</option>
          {audioOutputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('settingsContent.speakerFallback', { id: d.deviceId.slice(0, 6) })}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={runMicTest} disabled={recordingTest}>
            {recordingTest && testCountdown !== null
              ? t('settingsContent.recordingCountdown', { seconds: testCountdown })
              : t('settingsContent.recordTest', { seconds: testDurationSec })}
          </Button>
          <input
            type="number"
            min={1}
            max={30}
            value={testDurationSec}
            onChange={(e) => setTestDurationSec(Number(e.target.value || 1))}
            className="w-16 bg-bg-input border border-border rounded px-2 py-1 text-sm text-text-primary"
          />
          {recordedUrl && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={toggleTestPlayback}
                className="w-10 h-10 rounded bg-bg-hover text-text-primary flex items-center justify-center"
                title={testPlaying ? t('settingsContent.stop') : t('settingsContent.play')}
              >
                {testPlaying ? '■' : '▶'}
              </button>
              <audio ref={testAudioRef} src={recordedUrl} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <p className="text-sm font-medium text-text-primary">{t('settingsContent.screenshareSettings')}</p>
        <ScreenshareSettingsPanel />
      </div>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <p className="text-sm font-medium text-text-primary">{t('settingsContent.audioProcessing')}</p>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={voiceCallE2EEEnabled}
            onChange={(e) => setVoiceCallE2EEEnabled(e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <span>
            <span className="block text-sm text-text-primary">{t('settingsContent.encryptVoiceCalls')}</span>
            <span className="block text-xs text-text-muted">{t('settingsContent.encryptVoiceCallsDesc')}</span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={rnnoiseEnabled}
            onChange={(e) => setRnnoiseEnabled(e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <span>
            <span className="block text-sm text-text-primary">{t('settingsContent.aiNoiseSuppression')}</span>
            <span className="block text-xs text-text-muted">{t('settingsContent.aiNoiseSuppressionDesc')}</span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={noiseGateEnabled}
            onChange={(e) => setNoiseGateEnabled(e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <span>
            <span className="block text-sm text-text-primary">Noise Gate</span>
            <span className="block text-xs text-text-muted">Mutes microphone below a volume threshold</span>
          </span>
        </label>

        {noiseGateEnabled && (() => {
          const MIN_DB = -60;
          const MAX_DB = -10;
          const range = MAX_DB - MIN_DB;
          // Percentage positions (0 = left, 100 = right)
          const levelPct  = Math.max(0, Math.min(100, ((meterDb - MIN_DB) / range) * 100));
          const threshPct = Math.max(0, Math.min(100, ((noiseGateThreshold - MIN_DB) / range) * 100));
          const aboveGate = meterDb >= noiseGateThreshold;

          return (
            <div className="pl-7 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-text-muted">Gate Threshold</label>
                <span className="text-xs text-text-primary tabular-nums">{noiseGateThreshold} dB</span>
              </div>

              {/* Threshold slider */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted w-10 shrink-0 text-right">-60</span>
                <input
                  type="range"
                  min={-60}
                  max={-10}
                  step={1}
                  value={noiseGateThreshold}
                  onChange={(e) => setNoiseGateThreshold(Number(e.target.value))}
                  className="flex-1 accent-emerald-400"
                  aria-label="Noise gate threshold in dB"
                />
                <span className="text-xs text-text-muted w-10 shrink-0">-10 dB</span>
              </div>

              {/* Live level meter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted w-10 shrink-0 text-right tabular-nums">
                  {meterDb > -60 ? `${Math.round(meterDb)}` : '–'}
                </span>
                <div className="relative flex-1 h-3 bg-bg-input rounded overflow-hidden">
                  {/* Level bar */}
                  <div
                    className={`absolute left-0 top-0 h-full rounded transition-none ${aboveGate ? 'bg-emerald-400' : 'bg-text-muted/40'}`}
                    style={{ width: `${levelPct}%` }}
                  />
                  {/* Threshold marker */}
                  <div
                    className="absolute top-0 h-full w-px bg-amber-400/90"
                    style={{ left: `${threshPct}%` }}
                  />
                </div>
                <span className="text-xs text-text-muted w-10 shrink-0">live</span>
              </div>
              <p className="text-[11px] text-text-muted leading-tight">
                Bar turns green when your mic is above the gate threshold. Set the threshold just below your voice level.
              </p>
            </div>
          );
        })()}
      </div>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Adjusted User Volumes</p>
            <p className="text-xs text-text-muted">Saved per-user voice playback levels (default is 50%).</p>
          </div>
          {adjustedEntries.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearPeerVolumes}>
              Reset All
            </Button>
          )}
        </div>
        {adjustedEntries.length === 0 ? (
          <p className="text-xs text-text-muted">
            No adjusted user volumes yet. Change a user volume from the voice tiles or right-click a voice member in the sidebar.
          </p>
        ) : (
          <div className="space-y-3">
            {adjustedEntries.map(([userId, volume]) => {
              const username = resolveAdjustedUsername(userId);
              return (
                <div key={`adj-voice-vol-${userId}`} className="rounded border border-border/70 bg-bg-input/40 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm text-text-primary truncate">{username}</div>
                      <div className="text-[11px] text-text-muted truncate">{userId}</div>
                    </div>
                    <div className="text-xs text-text-muted shrink-0">{volume}%</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={300}
                      step={5}
                      value={volume}
                      onChange={(e) => setPeerVolume(userId, Number(e.target.value) || 0)}
                      className="flex-1 accent-emerald-400"
                      aria-label={`Adjusted volume for ${username}`}
                    />
                    <Button variant="secondary" size="sm" onClick={() => setPeerVolume(userId, 50)}>
                      Reset
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
