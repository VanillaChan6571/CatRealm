import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SoundToggle } from './SoundToggle';
import { usePushSettingsStore } from '../../../stores/pushSettingsStore';

type NotificationsTabProps = {
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  settings: any;
  setSoundSetting: (key: string, value: boolean) => void;
  setSoundVolume: (key: string, value: number) => void;
  isCentral?: boolean;
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span className={`w-12 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-hover'} relative`}>
        <span className={`absolute top-1 ${checked ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
      </span>
    </label>
  );
}

export function NotificationsTab(props: NotificationsTabProps) {
  const { t } = useTranslation();
  const {
    notificationsEnabled,
    setNotificationsEnabled,
    settings,
    setSoundSetting,
    setSoundVolume,
    isCentral,
  } = props;

  const { prefs, loaded, load, savePref } = usePushSettingsStore();

  useEffect(() => {
    if (isCentral && !loaded) load();
  }, [isCentral, loaded, load]);

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.navNotifications')}</h3>

      {/* Mobile Push Notifications */}
      {isCentral && (
        <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settingsContent.mobilePush')}</h4>
            <p className="text-xs text-text-muted mt-1">{t('settingsContent.mobilePushDesc')}</p>
          </div>
          {[
            { key: 'pushWhenOnline' as const, label: t('settingsContent.pushWhenOnline'), desc: t('settingsContent.pushWhenOnlineDesc') },
            { key: 'notifDMs' as const, label: t('settingsContent.directMessages'), desc: t('settingsContent.directMessagesDesc') },
            { key: 'notifServers' as const, label: t('settingsContent.serverMentions'), desc: t('settingsContent.serverMentionsDesc') },
            { key: 'notifFriendRequests' as const, label: t('settingsContent.friendRequests'), desc: t('settingsContent.friendRequestsDesc') },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">{label}</p>
                <p className="text-xs text-text-muted">{desc}</p>
              </div>
              <Toggle checked={loaded ? prefs[key] : false} onChange={(v) => savePref(key, v)} />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.enableNotificationSounds')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.enableNotificationSoundsDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(e) => setNotificationsEnabled(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              notificationsEnabled ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${notificationsEnabled ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      {/* Chat Sounds */}
      <div className="space-y-6 bg-bg-hover/30 p-4 rounded-lg">
        <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settingsContent.chatSounds')}</h4>
        <SoundToggle label={t('settingsContent.newMessageCurrentChannel')} settingKey="soundMessageInChannel" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="message-in-channel" />
        <SoundToggle label={t('settingsContent.newMessageCurrentServer')} settingKey="soundMessageInServer" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="message-in-server" />
        <SoundToggle label={t('settingsContent.messageMentioned')} settingKey="soundMessageMention" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="message-mention" />
        <SoundToggle label={t('settingsContent.messageEveryone')} settingKey="soundMessageEveryone" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="message-everyone" />
      </div>

      {/* DM Sounds */}
      <div className="space-y-6 bg-bg-hover/30 p-4 rounded-lg">
        <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settingsContent.dmSounds')}</h4>
        <SoundToggle label={t('settingsContent.incomingCall')} settingKey="soundDMIncomingCall" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="dm-incoming-call" />
        <SoundToggle label={t('settingsContent.outgoingCall')} settingKey="soundDMOutgoingCall" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="dm-outgoing-call" />
        <SoundToggle label={t('settingsContent.newMessageCurrentDm')} settingKey="soundDMMessageInCurrent" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="dm-message-current" />
        <SoundToggle label={t('settingsContent.newMessageFromDm')} settingKey="soundDMMessageFromOther" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="dm-message-other" />
      </div>

      {/* Voice Chat Sounds */}
      <div className="space-y-6 bg-bg-hover/30 p-4 rounded-lg">
        <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settingsContent.voiceChatSounds')}</h4>
        <SoundToggle label={t('settingsContent.deafen')} settingKey="soundVoiceDeafen" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-deafen" />
        <SoundToggle label={t('settingsContent.undeafen')} settingKey="soundVoiceUndeafen" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-undeafen" />
        <SoundToggle label={t('settingsContent.mute')} settingKey="soundVoiceMute" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-mute" />
        <SoundToggle label={t('settingsContent.unmute')} settingKey="soundVoiceUnmute" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-unmute" />
        <SoundToggle label={t('settingsContent.pttActivate')} settingKey="soundVoicePTTActivate" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-ptt-activate" />
        <SoundToggle label={t('settingsContent.pttDeactivate')} settingKey="soundVoicePTTDeactivate" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-ptt-deactivate" />
      </div>

      {/* Voice Chat Users */}
      <div className="space-y-6 bg-bg-hover/30 p-4 rounded-lg">
        <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settingsContent.voiceChatUsers')}</h4>
        <SoundToggle label={t('settingsContent.userJoined')} settingKey="soundVoiceUserJoined" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-user-joined" />
        <SoundToggle label={t('settingsContent.userLeft')} settingKey="soundVoiceUserLeft" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-user-left" />
        <SoundToggle label={t('settingsContent.userMoved')} settingKey="soundVoiceUserMoved" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="voice-user-moved" />
      </div>

      {/* Extra Voice Chat Sounds */}
      <div className="space-y-6 bg-bg-hover/30 p-4 rounded-lg">
        <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settingsContent.extraVoiceChatSounds')}</h4>
        <SoundToggle label={t('settingsContent.screenshareGoLive')} settingKey="soundScreenshareGoLive" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="screenshare-go-live" />
        <SoundToggle label={t('settingsContent.screenshareUserJoin')} settingKey="soundScreenshareUserJoin" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="screenshare-user-join" />
        <SoundToggle label={t('settingsContent.screenshareUserLeft')} settingKey="soundScreenshareUserLeft" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="screenshare-user-left" />
        <SoundToggle label={t('settingsContent.screenshareEnded')} settingKey="soundScreenshareEnded" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="screenshare-ended" />
        <SoundToggle label={t('settingsContent.screenshareStopped')} settingKey="soundScreenshareStopped" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="screenshare-stopped" />
        <SoundToggle label={t('settingsContent.rtcFailed')} settingKey="soundRTCFailed" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="rtc-failed" />
        <SoundToggle label={t('settingsContent.rtcReconnecting')} settingKey="soundRTCReconnecting" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="rtc-reconnecting" />
      </div>

      {/* Very Extra (Disabled By Default) */}
      <div className="space-y-6 bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settingsContent.veryExtraSounds')}</h4>
          <p className="text-xs text-text-muted mt-1">{t('settingsContent.disabledByDefault')}</p>
        </div>
        <SoundToggle label={t('settingsContent.uiButtonClick')} settingKey="soundUIButtonClick" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="ui-button-click" />
        <SoundToggle label={t('settingsContent.hourlyBeep')} settingKey="soundHourlyBeep" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="hourly-beep" />
        <SoundToggle label={t('settingsContent.ambienceSounds')} settingKey="soundAmbience" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="ambience" />
        <SoundToggle label={t('settingsContent.newChannelCreated')} settingKey="soundChannelCreated" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="channel-created" />
        <SoundToggle label={t('settingsContent.newCategoryCreated')} settingKey="soundCategoryCreated" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="category-created" />
        <SoundToggle label={t('settingsContent.uploadingAttachments')} settingKey="soundUploadingAttachment" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="uploading-attachment" />
        <SoundToggle label={t('settingsContent.typing')} settingKey="soundTyping" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="typing" />
        <SoundToggle label={t('settingsContent.sendMessageSound')} settingKey="soundSendMessage" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="send-message" />
        <SoundToggle label={t('settingsContent.channelDeleted')} settingKey="soundChannelDeleted" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="channel-deleted" />
        <SoundToggle label={t('settingsContent.categoryDeleted')} settingKey="soundCategoryDeleted" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="category-deleted" />
        <SoundToggle label={t('settingsContent.deletingMessage')} settingKey="soundDeletingMessage" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="deleting-message" />
        <SoundToggle label={t('settingsContent.editingMessage')} settingKey="soundEditingMessage" settings={settings} setSoundSetting={setSoundSetting} setSoundVolume={setSoundVolume} soundType="editing-message" />
      </div>
    </div>
  );
}
