/**
 * The user settings sections, shared by the Me tab's settings list and the
 * section menu on the tablet settings screen.
 */

import type { TFunction } from 'i18next';
import {
  Bell,
  FlaskConical,
  HardDrive,
  Languages,
  Mic,
  Palette,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  UserRound,
} from 'lucide-react-native';

export type SettingsSection =
  | 'profile'
  | 'server-profiles'
  | 'account-security'
  | 'voice'
  | 'notifications'
  | 'appearance'
  | 'emotes-settings'
  | 'content-social'
  | 'storage'
  | 'language'
  | 'cat-lab';

export interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  Icon: typeof Bell;
}

const ALL_SECTIONS: readonly SettingsSection[] = [
  'profile', 'server-profiles', 'account-security', 'voice', 'notifications', 'appearance',
  'emotes-settings', 'content-social', 'storage', 'language', 'cat-lab',
];

export function normalizeSettingsSection(section: string | undefined): SettingsSection {
  return ALL_SECTIONS.includes(section as SettingsSection) ? (section as SettingsSection) : 'profile';
}

/** Server Profiles, Account Security and Cat Lab need a Central account, as on desktop. */
export function settingsNavItems(
  t: TFunction,
  isCentral: boolean,
  { includeProfile }: { includeProfile: boolean },
): SettingsNavItem[] {
  return [
    ...(includeProfile ? [{ id: 'profile' as const, label: t('settings.navProfile'), Icon: UserRound }] : []),
    ...(isCentral ? [{ id: 'server-profiles' as const, label: t('settings.navServerProfiles'), Icon: Server }] : []),
    ...(isCentral ? [{ id: 'account-security' as const, label: t('settings.navAccountSecurity'), Icon: ShieldCheck }] : []),
    { id: 'voice', label: t('settings.navVoice'), Icon: Mic },
    { id: 'notifications', label: t('settings.navNotifications'), Icon: Bell },
    { id: 'appearance', label: t('settings.navAppearance'), Icon: Palette },
    { id: 'emotes-settings', label: t('settings.navEmotesSettings'), Icon: Smile },
    { id: 'content-social', label: t('settings.navContentSocial'), Icon: SlidersHorizontal },
    { id: 'storage', label: t('settings.navStorage'), Icon: HardDrive },
    { id: 'language', label: t('settings.navLanguage'), Icon: Languages },
    ...(isCentral ? [{ id: 'cat-lab' as const, label: t('settings.navCatLab'), Icon: FlaskConical }] : []),
  ];
}
