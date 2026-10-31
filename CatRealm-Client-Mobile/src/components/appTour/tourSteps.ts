import type { useRouter } from 'expo-router';
import { useUIStore } from '@/stores/uiStore';

export type TourContext = { router: ReturnType<typeof useRouter>; pathname: string };

export type TourStep = {
  // A TourAnchor name; steps whose anchor isn't mounted are skipped.
  target?: string;
  title: string;
  body: string;
  // Run as the step comes up, before its anchor is looked for: navigate, open
  // or close something for the user (it also runs when stepping back to it).
  onEnter?: (ctx: TourContext) => void;
  // The user does this themselves; the step moves on once it returns true.
  waitFor?: (ctx: TourContext) => boolean;
  // Skip the step unless this holds when it comes up.
  when?: () => boolean;
  // Leave the screen usable (no dimming or touch blocking) so they can act on it.
  interactive?: boolean;
  // A secondary button that moves on without doing the thing.
  laterLabel?: string;
};

const ui = () => useUIStore.getState();
const goHome = ({ router }: TourContext) => router.replace('/(app)/(tabs)/home');
const inEditMode = () => ui().profileEditMode;

const settingsRow = (id: string, title: string, body: string): TourStep => ({
  target: `settings-row-${id}`,
  // The rows only show outside edit mode; uploads have already saved.
  onEnter: () => ui().setProfileEditMode(false),
  title,
  body,
});

export const TOUR_STEPS: TourStep[] = [
  { onEnter: goHome, title: 'Welcome to CatRealm', body: 'A quick look at where everything lives. You can skip it any time.' },
  { target: 'dock-home', title: 'Home', body: 'Your friends, friend requests and recent chats.' },
  { target: 'dock-servers', onEnter: () => ui().setServerDrawerOpen(false), title: 'Servers', body: 'Your realms. Double-tap to open the server list from anywhere.' },
  { target: 'discover', onEnter: () => ui().setServerDrawerOpen(true), title: 'Discover servers', body: 'Browse public servers here and join any that look fun.' },
  { target: 'dock-chats', onEnter: () => ui().setServerDrawerOpen(false), title: 'Chats', body: 'Your direct messages and group chats.' },
  { target: 'dock-notifications', title: 'Notifications', body: 'Mentions, replies and requests, all in one place.' },
  {
    target: 'dock-me',
    onEnter: goHome,
    waitFor: ({ pathname }) => pathname.startsWith('/me'),
    title: 'Open your profile',
    body: 'Tap You to continue.',
  },
  {
    target: 'profile-edit',
    onEnter: () => ui().setProfileEditMode(false),
    waitFor: inEditMode,
    laterLabel: 'Will do later',
    title: 'Edit your profile',
    body: 'Tap the pencil to set a profile picture and banner.',
  },
  { target: 'profile-avatar', when: inEditMode, interactive: true, laterLabel: 'Will do later', title: 'Add a profile picture', body: 'Tap your avatar to upload one.' },
  { target: 'profile-banner', when: inEditMode, interactive: true, laterLabel: 'Will do later', title: 'Add a banner', body: 'Tap the banner to upload one.' },
  settingsRow('server-profiles', 'Server Profiles', 'Use a different picture or banner on specific servers. Your main profile is the fallback.'),
  settingsRow('account-security', 'Account Security', 'Your signed-in devices, passkeys and security keys.'),
  settingsRow('voice', 'Voice & Video', 'Microphone, speakers, and voice activity or push to talk.'),
  settingsRow('notifications', 'Notifications', 'Push notifications, and the sounds for messages, calls and voice.'),
  settingsRow('appearance', 'Appearance', 'Themes and how heavy the animations are.'),
  settingsRow('emotes-settings', 'Emotes & Settings', 'How large emotes appear, plus your personal emotes.'),
  settingsRow('content-social', 'Content & Social', 'NSFW filters and the link domains you trust.'),
  settingsRow('storage', 'Cat Cache', 'How much space images, videos and emotes may use on this phone.'),
  settingsRow('language', 'Language', 'The language CatRealm uses on this device.'),
  settingsRow('cat-lab', 'Cat Lab', 'Experimental features. Fun, but use them at your own risk.'),
  { title: "You're all set", body: 'You can replay this tour from the You tab whenever you like. Have fun!' },
];
