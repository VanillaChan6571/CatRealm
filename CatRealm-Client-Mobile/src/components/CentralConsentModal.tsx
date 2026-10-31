import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, View } from 'react-native';
import { useTheme } from '@/theme';
import { createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Pressable, Text } from '@/components';

type ConsentStatus = { required: boolean };

export function CentralConsentModal() {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const [required, setRequired] = useState<boolean | null>(null);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    const checkedUserId = useAuthStore.getState().user?.id;
    setCheckedUserId(checkedUserId ?? null);
    setRequired(null);
    setError('');
    try {
      const response = await createAuthenticatedApi().get<ConsentStatus>('/api/consent');
      if (useAuthStore.getState().user?.id === checkedUserId) setRequired(response.data.required);
    } catch {
      if (useAuthStore.getState().user?.id === checkedUserId) setError('Could not check your account. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    setPrivacy(false); setTerms(false); setAge(false);
    if (user?.accountType === 'central') void check();
    else setRequired(false);
  }, [user?.id, user?.accountType, check]);

  async function accept() {
    if (!privacy || !terms || !age) return;
    const acceptingUserId = useAuthStore.getState().user?.id;
    setBusy(true);
    setError('');
    try {
      const response = await createAuthenticatedApi().post<ConsentStatus>('/api/consent', {
        acceptPrivacy: privacy, acceptTerms: terms, confirmAge18: age,
        termsVersion: '2026-10-17', privacyVersion: '2026-10-17',
      });
      if (useAuthStore.getState().user?.id === acceptingUserId) setRequired(response.data.required);
    } catch {
      if (useAuthStore.getState().user?.id === acceptingUserId) setError('Could not save your choices. Please try again.');
    } finally { setBusy(false); }
  }

  if (user?.accountType !== 'central') return null;
  const currentRequirement = checkedUserId === user.id ? required : null;
  const link = (label: string, url: string) => (
    <Pressable onPress={() => void Linking.openURL(url)}><Text color={theme.colors.accent}>{label}</Text></Pressable>
  );
  const checkbox = (checked: boolean, toggle: () => void, label: string) => (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={toggle} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Text color={theme.colors.accent}>{checked ? '☑' : '☐'}</Text>
      <Text color={theme.colors.text2} style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );

  return <Modal visible={checkedUserId === user.id && (currentRequirement === true || !!error)} animationType="fade" onRequestClose={() => {}} supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.colors.bgDeepest }}>
      <View style={{ backgroundColor: theme.colors.bgElev1, borderRadius: 18, padding: 22, gap: 16 }}>
        <Text variant="title" color={theme.colors.text}>Continue using CatRealm Central</Text>
        <Text color={theme.colors.text2}>Please review the current policies and confirm your age to continue. You can log out if you do not agree.</Text>
        {currentRequirement === true ? <>
          {checkbox(privacy, () => setPrivacy(!privacy), 'I have read and agree to the Privacy Policy.')}
          {link('Read Privacy Policy', 'https://catrealm.app/privacy/')}
          {checkbox(terms, () => setTerms(!terms), 'I have read and agree to the Terms of Service.')}
          {link('Read Terms of Service', 'https://catrealm.app/terms/')}
          {checkbox(age, () => setAge(!age), 'I confirm that I am 18 years of age or older.')}
        </> : !error ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {error ? <Text color={theme.colors.danger}>{error}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => void signOut()} style={{ padding: 12, borderRadius: 10, backgroundColor: theme.colors.bgElev3 }}><Text color={theme.colors.text}>Log out</Text></Pressable>
          {currentRequirement === null
            ? <Pressable onPress={() => void check()} style={{ padding: 12, borderRadius: 10, backgroundColor: theme.colors.accent }}><Text color={theme.colors.textOnAccent}>Retry</Text></Pressable>
            : <Pressable disabled={!privacy || !terms || !age || busy} onPress={() => void accept()} style={{ padding: 12, borderRadius: 10, backgroundColor: privacy && terms && age ? theme.colors.accent : theme.colors.bgElev3 }}><Text color={privacy && terms && age ? theme.colors.textOnAccent : theme.colors.text3}>{busy ? 'Saving…' : 'Agree and continue'}</Text></Pressable>}
        </View>
      </View>
    </ScrollView>
  </Modal>;
}
