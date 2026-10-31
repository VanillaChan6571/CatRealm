export type TourStep = {
  // A [data-tour] anchor; steps whose anchor isn't on screen are skipped.
  target?: string;
  title: string;
  body: string;
  // Run when the step is entered: click an anchor for the user, or close
  // whatever modal is open.
  onEnter?: { click: string } | 'closeModal';
  // The user has to do this themselves; Next is replaced by a hint.
  waitFor?: 'settingsOpen';
  // Leave the page usable (no dimming or click blocking) so they can act on it.
  interactive?: boolean;
  // A secondary button that moves on without doing the thing.
  laterLabel?: string;
};

const settingsTab = (id: string, title: string, body: string): TourStep => ({
  target: `settings-tab-${id}`,
  onEnter: { click: `settings-tab-${id}` },
  title,
  body,
});

export const TOUR_STEPS: TourStep[] = [
  { onEnter: { click: 'home' }, title: 'Welcome to CatRealm', body: 'A quick look at where everything lives. You can skip it any time.' },
  { target: 'home', title: 'Home', body: 'Your friends, direct messages and group chats live here. Click it to come back from any server.' },
  { target: 'home-nav', title: 'Friends and notes', body: 'Your notifications and friends list, adding friends, and your personal notes.' },
  { target: 'discover', onEnter: { click: 'discover' }, title: 'Discover servers', body: 'Browse public servers here and join any that look fun.' },
  { target: 'chats', title: 'Your conversations', body: 'Switch between direct chats and group chats.' },
  { target: 'add-server', title: 'Join a server', body: 'Join a realm with an invite, or connect to a server by its address.' },
  { target: 'voice-controls', title: 'Mic, sound, privacy and changelog', body: "Mute or deafen yourself, open your privacy dashboard, and see what's new." },
  { target: 'profile', title: 'Your profile', body: 'Your name and status. Click it any time to edit your profile.' },
  { target: 'settings', onEnter: 'closeModal', waitFor: 'settingsOpen', title: 'Open Settings', body: 'Click the settings cog to continue.' },
  settingsTab('profile', 'Main Profile', 'How you appear across CatRealm: picture, banner, display name, bio and status.'),
  { target: 'profile-avatar', interactive: true, laterLabel: 'Will do later', title: 'Add a profile picture', body: 'Click your avatar to upload one.' },
  { target: 'profile-banner', interactive: true, laterLabel: 'Will do later', title: 'Add a banner', body: 'Upload a banner for the top of your profile card.' },
  settingsTab('server-profiles', 'Server Profiles', 'Use a different picture or banner on specific servers. Your main profile is the fallback.'),
  settingsTab('account-security', 'Account Security', 'Your signed-in devices, passkeys and security keys.'),
  settingsTab('voice', 'Voice', 'Microphone and speakers, and voice activity or push to talk.'),
  settingsTab('notifications', 'Notifications', 'Mobile push notifications, and the sounds for messages, calls and voice.'),
  settingsTab('appearance', 'Appearance', 'Themes, custom themes, and how heavy the animations are.'),
  settingsTab('emotes-settings', 'Emotes', 'How large emotes appear, plus your personal emotes.'),
  settingsTab('windows', 'Desktop', 'Open on startup, minimise to tray, and opening links inside CatRealm.'),
  settingsTab('updates', 'Updates', 'Check for updates and pick your update channel.'),
  settingsTab('time-format', 'Time Format', 'A 12 or 24 hour clock.'),
  settingsTab('language', 'Language', 'The language CatRealm uses on this device.'),
  settingsTab('streamer-mode', 'Streamer Mode', 'Hide personal information and mute sounds while you stream or record.'),
  settingsTab('content-social', 'Content & Social', 'NSFW filters and the link domains you trust.'),
  settingsTab('cat-lab', 'Cat Lab', 'Experimental features. Fun, but use them at your own risk.'),
  { onEnter: 'closeModal', title: "You're all set", body: 'You can replay this tour from Settings whenever you like. Have fun!' },
];
