/**
 * "You" tab — own profile landing surface.
 * Mirrors the desktop profile hierarchy with a mobile-native layout.
 * TODO: Still add a border for Cat Lab Experimental Badge for Game Activity w/ Modal if tapped on explaining what Catlab Experimental means.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated as RNAnimated, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useRouter } from 'expo-router';
import { useNavigationState } from "expo-router/react-navigation";
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Bell,
  ChevronRight,
  Compass,
  HardDrive,
  Languages,
  LogOut,
  FlaskConical,
  Mic,
  Pencil,
  Palette,
  Plus,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  SquareCheck,
  SquarePen,
  UserPen,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Avatar, Pressable, StatusDot, FadeInImage } from '@/components';
import { TourAnchor, TourScrollProvider, useTourScroller } from '@/components/TourAnchor';
import { useAppTourStore } from '@/lib/appTour';
import Constants from 'expo-constants';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSettingsAmbience } from '@/hooks/useSettingsAmbience';
import { useUIStore } from '@/stores/uiStore';
import { useSavedAccountsStore } from '@/stores/savedAccountsStore';
import { createApi, createAuthenticatedApi } from '@/lib/api';
import { appendFormDataFile } from '@/lib/formData';
import { resolveMediaUrl } from '@/utils/mediaUrl';
import { AddAccountSheet } from '@/components/AddAccountSheet';
import type { UserStatus } from '@/types';

type SettingsSection =
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

type SettingsItem = {
  id: SettingsSection;
  label: string;
  Icon: typeof Bell;
};

const STATUSES: { value: UserStatus; label: string; selectable?: boolean }[] = [
  { value: 'online', label: 'Online' },
  { value: 'away', label: 'Away' },
  { value: 'sleeping', label: 'Sleeping (auto)', selectable: false },
  { value: 'invisible', label: 'Offline' },
];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g).toString(16).padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`;
}

function mixHex(base: string, target: string, amount: number): string {
  const baseRgb = hexToRgb(base);
  const targetRgb = hexToRgb(target);
  if (!baseRgb || !targetRgb) return base;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    baseRgb.r + (targetRgb.r - baseRgb.r) * t,
    baseRgb.g + (targetRgb.g - baseRgb.g) * t,
    baseRgb.b + (targetRgb.b - baseRgb.b) * t,
  );
}

function EditButtonBorderChaser({
  accent,
  rim,
  text,
  surface,
}: {
  accent: string;
  rim: string;
  text: string;
  surface: string;
}) {
  const sparklePulse = useRef(new RNAnimated.Value(0)).current;
  const borderSpin = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const sparkleLoop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(sparklePulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        RNAnimated.timing(sparklePulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    sparklePulse.setValue(0);
    sparkleLoop.start();
    return () => sparkleLoop.stop();
  }, [sparklePulse]);

  useEffect(() => {
    borderSpin.setValue(0);
    const spinLoop = RNAnimated.loop(
      RNAnimated.timing(borderSpin, { toValue: 1, duration: 3200, useNativeDriver: true }),
    );
    spinLoop.start();
    return () => spinLoop.stop();
  }, [borderSpin]);

  const sparkleOpacity = sparklePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });
  const borderGlowOpacity = sparklePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.55],
  });
  const borderRotate = borderSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const borderGradientColors = [
    mixHex(accent, '#ffffff', 0.12),
    rim,
    mixHex(accent, text, 0.32),
    mixHex(accent, '#ffffff', 0.06),
    mixHex(accent, '#000000', 0.14),
    mixHex(accent, '#ffffff', 0.12),
  ] as const;

  return (
    <>
      <RNAnimated.View
        pointerEvents="none"
        style={[styles.editGlowBorder, { opacity: borderGlowOpacity, shadowColor: accent }]}
      />
      <RNAnimated.View pointerEvents="none" style={styles.editGradientRingWrap}>
        <RNAnimated.View style={[styles.editGradientSpinner, { transform: [{ rotate: borderRotate }] }]}>
          <LinearGradient
            colors={borderGradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.editGradientRing}
          />
        </RNAnimated.View>
      </RNAnimated.View>
      <View style={[styles.editRingInnerMask, { backgroundColor: surface }]}>
        <RNAnimated.View pointerEvents="none" style={[styles.editSparkleDot, styles.editSparkleTopRight, { backgroundColor: accent, opacity: sparkleOpacity }]} />
        <RNAnimated.View pointerEvents="none" style={[styles.editSparkleDot, styles.editSparkleBottomLeft, { backgroundColor: accent, opacity: sparkleOpacity }]} />
      </View>
    </>
  );
}


// The mobile edition is "Denshi", as desktop's are "Sushi" (Tauri) and "Sparky" (Electron).
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

export default function MeTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const tourScroller = useTourScroller(scrollRef);
  const insets = useSafeAreaInsets();
  const { isTablet, width } = useDeviceLayout();
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const signOut = useAuthStore((s) => s.signOut);
  const switchToAccount = useAuthStore((s) => s.switchToAccount);
  const removeFromSavedAccounts = useAuthStore((s) => s.removeFromSavedAccounts);
  const applyProfile = useAuthStore((s) => s.applyProfile);
  const profileEditMode = useUIStore((s) => s.profileEditMode);
  const setProfileEditMode = useUIStore((s) => s.setProfileEditMode);
  const savedAccounts = useSavedAccountsStore((s) => s.accounts);
  const loadSavedAccounts = useSavedAccountsStore((s) => s.load);
  const [addAccountVisible, setAddAccountVisible] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [customStatusDraft, setCustomStatusDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<UserStatus>('online');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState<'avatar' | 'banner' | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const bannerUrl = resolveMediaUrl(
    user?.banner ?? null,
    user?.accountType === 'local' ? serverUrl : undefined,
  );
  const heroHeight = isTablet ? 350 : Math.max(120, Math.min(300, width * 0.33));
  const activityText =
    user?.activityType && user.activityText ? `${user.activityType} ${user.activityText}` : null;

  // useNavigationState reads the TAB navigator's active route — not screen focus.
  // This means the sound keeps playing when a modal (settings) is pushed on top of the
  // Me tab, because the tab navigator still reports 'me' as the active route.
  // The sound only stops when the user actually switches to a different tab.
  const isMeTabActive = useNavigationState((state) => state.routes[state.index]?.name === 'me');
  const soundAmbience = useSettingsStore((s) => s.soundAmbience);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const ambienceVolume = useSettingsStore((s) => s.soundVolumes.soundAmbience ?? 100);
  useSettingsAmbience(isMeTabActive && soundAmbience && notificationsEnabled, ambienceVolume);

  const profileApi = () =>
    user?.accountType === 'central' ? createAuthenticatedApi() : createApi();

  const hydrateDrafts = () => {
    setDisplayNameDraft(user?.displayName ?? '');
    setBioDraft(user?.bio ?? '');
    setCustomStatusDraft(user?.customStatusText ?? '');
    setStatusDraft((user?.status as UserStatus | undefined) ?? 'online');
    setEditMessage(null);
  };

  const enterEditMode = () => {
    hydrateDrafts();
    setProfileEditMode(true);
  };

  const exitEditMode = () => {
    setProfileEditMode(false);
    setEditMessage(null);
  };

  useEffect(() => {
    return () => setProfileEditMode(false);
  }, [setProfileEditMode]);

  useEffect(() => {
    void loadSavedAccounts();
  }, [loadSavedAccounts]);

  const handleSwitchAccount = async (userId: string) => {
    const err = await switchToAccount(userId);
    if (err) {
      Alert.alert(t('settings.switchFailedTitle'), err);
    } else {
      router.replace('/(app)/(tabs)/home');
    }
  };

  const handleRemoveSavedAccount = (userId: string, username: string) => {
    Alert.alert(
      t('settings.removeAccountTitle'),
      t('settings.removeAccountMsg', { username }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => void removeFromSavedAccounts(userId),
        },
      ],
    );
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/welcome');
  };

  const handleUploadMedia = async (kind: 'avatar' | 'banner') => {
    if (!profileEditMode || uploadingMedia) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    const formData = new FormData();
    await appendFormDataFile(formData, kind, {
      uri: asset.uri,
      type: asset.mimeType ?? 'image/jpeg',
      name: asset.name ?? `${kind}.jpg`,
    });

    setUploadingMedia(kind);
    setEditMessage(null);
    try {
      const res = await profileApi().post<Record<string, unknown>>(`/api/profile/me/${kind}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await applyProfile(res.data);
    } catch {
      setEditMessage(`Could not upload ${kind}.`);
    } finally {
      setUploadingMedia(null);
    }
  };

  const handleSaveProfile = async () => {
    if (savingProfile) return;
    setSavingProfile(true);
    setEditMessage(null);
    const api = profileApi();
    try {
      const displayName = displayNameDraft.trim();
      const bio = bioDraft.trim();
      const customStatusText = customStatusDraft.trim();
      await (displayName
        ? api.put('/api/profile/me/display-name', { displayName })
        : api.delete('/api/profile/me/display-name'));
      await api.put('/api/profile/me', { bio });
      await api.put('/api/profile/me/status', { status: statusDraft });
      const res = await (customStatusText
        ? api.put<Record<string, unknown>>('/api/profile/me/custom-status', { customStatusText })
        : api.delete<Record<string, unknown>>('/api/profile/me/custom-status'));
      await applyProfile(res.data);
      exitEditMode();
    } catch {
      setEditMessage('Could not save profile changes.');
    } finally {
      setSavingProfile(false);
    }
  };

  const settingsItems: SettingsItem[] = [
    ...(user?.accountType === 'central'
      ? [{ id: 'server-profiles' as const, label: t('settings.navServerProfiles'), Icon: Server }]
      : []),
    ...(user?.accountType === 'central'
      ? [{ id: 'account-security' as const, label: t('settings.navAccountSecurity'), Icon: ShieldCheck }]
      : []),
    { id: 'voice', label: t('settings.navVoice'), Icon: Mic },
    { id: 'notifications', label: t('settings.navNotifications'), Icon: Bell },
    { id: 'appearance', label: t('settings.navAppearance'), Icon: Palette },
    { id: 'emotes-settings', label: t('settings.navEmotesSettings'), Icon: Smile },
    { id: 'content-social', label: t('settings.navContentSocial'), Icon: SlidersHorizontal },
    { id: 'storage', label: t('settings.navStorage'), Icon: HardDrive },
    { id: 'language', label: t('settings.navLanguage'), Icon: Languages },
    ...(user?.accountType === 'central'
      ? [{ id: 'cat-lab' as const, label: t('settings.navCatLab'), Icon: FlaskConical }]
      : []),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        onScroll={tourScroller.onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingBottom: insets.bottom + (profileEditMode ? 112 : 96) }}
      >
        <TourScrollProvider value={tourScroller.scrollIntoView}>
        <TourAnchor name="profile-banner">
        <Pressable
          haptic={profileEditMode}
          disabled={!profileEditMode || !!uploadingMedia}
          onPress={() => void handleUploadMedia('banner')}
          style={[styles.hero, { backgroundColor: theme.colors.bgElev1, height: heroHeight }]}
        >
          {bannerUrl ? (
            <FadeInImage uri={bannerUrl} style={StyleSheet.absoluteFill} />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: theme.colors.bgSidebar,
                  borderBottomColor: theme.colors.line,
                  borderBottomWidth: 1,
                },
              ]}
            />
          )}
          {profileEditMode ? (
            <View style={styles.bannerEditOverlay}>
              {uploadingMedia === 'banner' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <SquarePen size={22} color="#fff" />
              )}
            </View>
          ) : null}
        </Pressable>
        </TourAnchor>

        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <View style={styles.profileHeader}>
            <TourAnchor name="profile-avatar">
            <Pressable
              haptic={profileEditMode}
              disabled={!profileEditMode || !!uploadingMedia}
              onPress={() => void handleUploadMedia('avatar')}
              style={styles.avatarEditTarget}
            >
              <Avatar
                username={user?.username ?? 'guest'}
                uri={user?.avatar}
                size={96}
                status={user?.status ?? null}
                style={{
                  borderWidth: 4,
                  borderColor: theme.colors.bgApp,
                  backgroundColor: theme.colors.bgElev2,
                }}
              />
              {profileEditMode ? (
                <View style={[styles.avatarEditBadge, { backgroundColor: theme.colors.accent }]}>
                  {uploadingMedia === 'avatar' ? (
                    <ActivityIndicator size="small" color={theme.colors.textOnAccent} style={{ transform: [{ scale: 0.65 }] }} />
                  ) : (
                    <SquarePen size={16} color={theme.colors.textOnAccent} />
                  )}
                </View>
              ) : null}
            </Pressable>
            </TourAnchor>
            <View style={styles.nameBlock}>
              <View style={styles.nameTitleRow}>
                <Text variant="title" numberOfLines={1} style={{ flex: 1 }}>
                  {user?.displayName ?? user?.username ?? 'Guest'}
                </Text>
                {!profileEditMode ? (
                  <Pressable
                    haptic
                    onPress={enterEditMode}
                    style={[
                      styles.iconAction,
                      {
                        backgroundColor: theme.colors.bgElev1,
                        borderColor: theme.colors.lineSoft,
                      },
                    ]}
                  >
                    <EditButtonBorderChaser
                      accent={theme.colors.accent}
                      rim={theme.colors.accentRim}
                      text={theme.colors.text}
                      surface={theme.colors.bgElev1}
                    />
                    <TourAnchor name="profile-edit">
                      <UserPen size={18} color={theme.colors.text2} style={styles.iconActionGlyph} />
                    </TourAnchor>
                  </Pressable>
                ) : null}
              </View>
              <Text variant="bodySmall" color={theme.colors.text3} numberOfLines={1}>
                @{user?.username ?? 'unknown'}
              </Text>
              {user?.status ? (
                <View style={styles.statusLine}>
                  <StatusDot status={user.status} size={8} />
                  <Text variant="caption" color={theme.colors.text3}>
                    {t(`status.${user.status}` as Parameters<typeof t>[0])}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
            {profileEditMode ? (
              <>
                <View style={[styles.panel, { backgroundColor: theme.colors.bgElev1 }]}>
                  <View style={styles.editSectionHeader}>
                    <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                      {t('settings.sectionDisplayName')}
                    </Text>
                    <Pencil size={15} color={theme.colors.text3} />
                  </View>
                  <TextInput
                    value={displayNameDraft}
                    onChangeText={setDisplayNameDraft}
                    placeholder={user?.username ?? 'Nickname'}
                    placeholderTextColor={theme.colors.text3}
                    maxLength={32}
                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                  />
                </View>

                <View style={[styles.panel, { backgroundColor: theme.colors.bgElev1 }]}>
                  <View style={styles.editSectionHeader}>
                    <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                      {t('settings.sectionStatus')}
                    </Text>
                    <Pencil size={15} color={theme.colors.text3} />
                  </View>
                  <View style={styles.statusGrid}>
                    {STATUSES.map(({ value, selectable = true }) => {
                      const active = statusDraft === value;
                      return (
                        <Pressable
                          key={value}
                          haptic={selectable}
                          disabled={!selectable}
                          onPress={() => setStatusDraft(value)}
                          style={[
                            styles.statusChip,
                            {
                              borderColor: active ? theme.colors.accent : theme.colors.lineSoft,
                              backgroundColor: active ? theme.colors.accent + '24' : 'transparent',
                              opacity: selectable ? 1 : 0.62,
                            },
                          ]}
                        >
                          <StatusDot status={value} size={8} />
                          <Text variant="caption" color={active ? theme.colors.accent : theme.colors.text2}>
                            {t(`status.${value}` as Parameters<typeof t>[0])}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={[styles.panel, { backgroundColor: theme.colors.bgElev1 }]}>
                  <View style={styles.editSectionHeader}>
                    <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                      {t('settings.sectionCustomStatus')}
                    </Text>
                    <Pencil size={15} color={theme.colors.text3} />
                  </View>
                  <TextInput
                    value={customStatusDraft}
                    onChangeText={setCustomStatusDraft}
                    placeholder={t('settings.customStatusPlaceholder')}
                    placeholderTextColor={theme.colors.text3}
                    maxLength={128}
                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                  />
                </View>
              </>
            ) : null}

            {!profileEditMode && user?.customStatusText ? (
              <View style={[styles.panel, { backgroundColor: theme.colors.bgElev1 }]}>
                <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                  {t('settings.sectionCustomStatus')}
                </Text>
                <Text variant="body" color={theme.colors.text}>
                  {user.customStatusText}
                </Text>
              </View>
            ) : null}

            {activityText ? (
              <View style={[styles.panel, { backgroundColor: theme.colors.bgElev1 }]}>
                <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                  {t('settings.activityLabel')}
                </Text>
                <Text variant="body" color={theme.colors.text}>
                  {activityText}
                </Text>
              </View>
            ) : null}

            <View style={[styles.panel, { backgroundColor: theme.colors.bgElev1 }]}>
              <View style={profileEditMode ? styles.editSectionHeader : undefined}>
                <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                  {t('settings.sectionBio')}
                </Text>
                {profileEditMode ? <Pencil size={15} color={theme.colors.text3} /> : null}
              </View>
              {profileEditMode ? (
                <>
                  <TextInput
                    value={bioDraft}
                    onChangeText={setBioDraft}
                    placeholder={t('settings.bioPlaceholder')}
                    placeholderTextColor={theme.colors.text3}
                    maxLength={500}
                    multiline
                    style={[styles.textArea, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                  />
                  <Text variant="caption" color={theme.colors.text3} style={{ marginTop: 8, textAlign: 'right' }}>
                    {bioDraft.length}/500
                  </Text>
                </>
              ) : (
                <Text variant="body" color={user?.bio ? theme.colors.text2 : theme.colors.text3}>
                  {user?.bio?.trim() || t('settings.noBioSet')}
                </Text>
              )}
            </View>

            {!profileEditMode ? <View style={[styles.panel, { backgroundColor: theme.colors.bgElev1 }]}>
              <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                {t('settings.sectionAccount')}
              </Text>
              <View style={styles.metaRow}>
                <Text variant="bodySmall" color={theme.colors.text3}>
                  {t('settings.accountType')}
                </Text>
                <Text variant="bodySmall" color={theme.colors.text2}>
                  {user?.accountType === 'central' ? t('settings.typeCentral') : t('settings.typeLocal')}
                </Text>
              </View>
              {serverUrl ? (
                <View style={styles.metaRow}>
                  <Text variant="bodySmall" color={theme.colors.text3}>
                    Server
                  </Text>
                  <Text
                    variant="bodySmall"
                    color={theme.colors.text2}
                    numberOfLines={1}
                    style={{ maxWidth: '70%' }}
                  >
                    {serverUrl}
                  </Text>
                </View>
              ) : null}
            </View> : null}

            {editMessage ? (
              <Text variant="bodySmall" color={editMessage.startsWith('Could') ? theme.colors.danger : theme.colors.text3}>
                {editMessage}
              </Text>
            ) : null}
          </View>

          {!profileEditMode ? <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
            <View style={[styles.settingsPanel, { backgroundColor: theme.colors.bgElev1 }]}>
              {settingsItems.map(({ id, label, Icon }, index) => (
                <TourAnchor key={id} name={`settings-row-${id}`}>
                <Pressable
                  haptic
                  onPress={() =>
                    router.push({
                      pathname: '/settings',
                      params: { section: id },
                    })
                  }
                  style={[
                    styles.settingsRow,
                    index < settingsItems.length - 1
                      ? {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: theme.colors.lineSoft,
                        }
                      : null,
                  ]}
                >
                  <Icon size={18} color={theme.colors.text2} />
                  <Text variant="subtitle" color={theme.colors.text2} style={{ flex: 1 }}>
                    {label}
                  </Text>
                  <ChevronRight size={18} color={theme.colors.text3} />
                </Pressable>
                </TourAnchor>
              ))}
            </View>

            {/* Accounts panel */}
            <View style={[styles.settingsPanel, { backgroundColor: theme.colors.bgElev1 }]}>
              <View style={[styles.accountsPanelHeader, { borderBottomColor: theme.colors.lineSoft }]}>
                <Text variant="caption" color={theme.colors.text3} style={styles.label}>
                  {t('settings.sectionAccount')}
                </Text>
              </View>
              {savedAccounts.map((account, index) => {
                const isActive = account.id === user?.id;
                return (
                  <Pressable
                    key={account.id}
                    haptic={!isActive}
                    onLongPress={
                      !isActive
                        ? () => handleRemoveSavedAccount(account.id, account.username)
                        : undefined
                    }
                    onPress={!isActive ? () => void handleSwitchAccount(account.id) : undefined}
                    style={[
                      styles.accountRow,
                      index < savedAccounts.length - 1
                        ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.lineSoft }
                        : null,
                      isActive ? { backgroundColor: theme.colors.accent + '18' } : null,
                    ]}
                  >
                    <Avatar
                      username={account.username}
                      uri={account.avatar}
                      size={28}
                      status={null}
                    />
                    <View style={styles.accountRowMeta}>
                      <Text variant="bodySmall" color={isActive ? theme.colors.accent : theme.colors.text2} numberOfLines={1}>
                        @{account.username}
                      </Text>
                      {account.displayName ? (
                        <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
                          {account.displayName}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.accountRowBadgeGroup}>
                      <View style={[styles.accountTypeBadge, { backgroundColor: theme.colors.bgElev2 }]}>
                        <Text variant="caption" color={theme.colors.text3}>
                          {account.accountType === 'central' ? t('settings.typeCentral') : t('settings.typeLocal')}
                        </Text>
                      </View>
                      {isActive ? (
                        <Text variant="caption" color={theme.colors.accent}>{t('common.active')}</Text>
                      ) : (
                        <Text variant="caption" color={theme.colors.text3} style={styles.switchHint}>
                          {t('settings.tapToSwitch')}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
              {savedAccounts.length < 5 ? (
                <Pressable
                  haptic
                  onPress={() => setAddAccountVisible(true)}
                  style={[
                    styles.addAccountRow,
                    savedAccounts.length > 0
                      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.lineSoft }
                      : null,
                  ]}
                >
                  <Plus size={16} color={theme.colors.accent} />
                  <Text variant="bodySmall" color={theme.colors.accent}>
                    {t('settings.addAccount')}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              haptic
              onPress={() => void handleSignOut()}
              style={[
                styles.action,
                { backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.lg },
              ]}
            >
              <LogOut size={18} color={theme.colors.danger} />
              <Text variant="subtitle" color={theme.colors.danger}>
                {t('settings.signOut')}
              </Text>
            </Pressable>

            <Pressable
              haptic
              onPress={() => useAppTourStore.getState().start()}
              style={[styles.action, { backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.lg }]}
            >
              <Compass size={18} color={theme.colors.text2} />
              <Text variant="subtitle" color={theme.colors.text2}>Replay app tour</Text>
            </Pressable>
          </View> : null}
          <Text variant="caption" color={theme.colors.text3} style={styles.versionLabel}>
            CatRealm v{APP_VERSION} (Denshi)
          </Text>
        </View>
        </TourScrollProvider>
      </ScrollView>
      {profileEditMode ? (
        <Pressable
          haptic
          onPress={() => void handleSaveProfile()}
          disabled={savingProfile}
          style={[
            styles.doneButton,
            {
              right: theme.spacing.lg,
              bottom: insets.bottom + theme.spacing.lg,
              backgroundColor: theme.colors.accent,
              opacity: savingProfile ? 0.68 : 1,
            },
          ]}
        >
          {savingProfile ? (
            <ActivityIndicator color={theme.colors.textOnAccent} />
          ) : (
            <SquareCheck size={28} color={theme.colors.textOnAccent} />
          )}
        </Pressable>
      ) : null}

      <AddAccountSheet
        visible={addAccountVisible}
        onClose={() => setAddAccountVisible(false)}
        onSuccess={() => {
          setAddAccountVisible(false);
          router.replace('/(app)/(tabs)/home');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: {
    overflow: 'hidden',
  },
  bannerEditOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.34)',
    justifyContent: 'center',
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
    marginTop: -24,
  },
  avatarEditTarget: {
    position: 'relative',
  },
  avatarEditBadge: {
    alignItems: 'center',
    borderRadius: 14,
    bottom: 2,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 2,
    width: 28,
  },
  nameBlock: {
    flex: 1,
    paddingBottom: 6,
  },
  nameTitleRow: {
    justifyContent: 'center',
    paddingRight: 42,
    position: 'relative',
  },
  iconAction: {
    alignItems: 'center',
    borderRadius: 18,
    height: 34,
    justifyContent: 'center',
    overflow: 'visible',
    position: 'absolute',
    right: 0,
    top: -1,
    width: 34,
  },
  iconActionGlyph: {
    zIndex: 2,
  },
  editGlowBorder: {
    borderRadius: 10,
    bottom: -1,
    left: -1,
    position: 'absolute',
    right: -1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
    top: -1,
  },
  editGradientRingWrap: {
    alignItems: 'center',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    width: 38,
  },
  editGradientSpinner: {
    height: 54,
    width: 54,
  },
  editGradientRing: {
    borderRadius: 10,
    flex: 1,
  },
  editRingInnerMask: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    width: 30,
  },
  editSparkleDot: {
    borderRadius: 2,
    height: 4,
    position: 'absolute',
    width: 4,
  },
  editSparkleTopRight: {
    right: 4,
    top: 4,
  },
  editSparkleBottomLeft: {
    bottom: 4,
    left: 4,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  panel: {
    borderRadius: 8,
    padding: 14,
  },
  editSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textArea: {
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 112,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  settingsPanel: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  versionLabel: {
    textAlign: 'center',
    marginTop: 24,
  },
  settingsRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  label: {
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  doneButton: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    width: 56,
  },
  accountsPanelHeader: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 52,
  },
  accountRowMeta: {
    flex: 1,
    minWidth: 0,
  },
  accountRowBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  accountTypeBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  switchHint: {
    opacity: 0.7,
  },
  addAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
