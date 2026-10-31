import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Pressable, Text } from '@/components';
import { createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useDMKeyReverificationStore } from '@/stores/dmKeyReverificationStore';
import { useTheme } from '@/theme';

export function PasskeyRecommendationBanner() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const accountSwitching = useAuthStore((state) => state.accountSwitching);
  const reverifyAccountId = useDMKeyReverificationStore((state) => state.accountId);
  const waitingDeviceId = useDMKeyReverificationStore((state) => state.waitingDeviceId);
  const accountId = user?.accountType === 'central' ? user.id : null;
  const inSettings = pathname.endsWith('/settings');
  const [checkedAccountId, setCheckedAccountId] = useState<string | null>(null);
  const [hasNoPasskeys, setHasNoPasskeys] = useState(false);
  const [dismissedAccountId, setDismissedAccountId] = useState<string | null>(null);

  useEffect(() => {
    setCheckedAccountId(null);
    if (!accountId || accountSwitching || inSettings) return;
    let active = true;
    let lastCheckedAt = 0;
    let revision = 0;
    const check = () => {
      if (Date.now() - lastCheckedAt < 30_000) return;
      lastCheckedAt = Date.now();
      const currentRevision = ++revision;
      void createAuthenticatedApi().get<{ credentials: unknown[] }>('/api/security/webauthn/credentials')
        .then(({ data }) => {
          const auth = useAuthStore.getState();
          if (!active || currentRevision !== revision || auth.accountSwitching || auth.user?.id !== accountId) return;
          setHasNoPasskeys(Array.isArray(data.credentials) && data.credentials.length === 0);
          setCheckedAccountId(accountId);
        })
        .catch(() => { if (active && currentRevision === revision) setCheckedAccountId(null); });
    };
    check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { active = false; subscription.remove(); };
  }, [accountId, accountSwitching, inSettings]);

  if (!accountId || accountSwitching || inSettings || checkedAccountId !== accountId || !hasNoPasskeys
    || dismissedAccountId === accountId || (reverifyAccountId === accountId && waitingDeviceId)) return null;

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.bgElev1, borderBottomWidth: 1, borderBottomColor: theme.colors.warning }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        <Text variant="body" style={{ fontWeight: '700' }}>Add a passkey or security key</Text>
        <Text variant="bodySmall" color={theme.colors.text2}>This Central account has no passkey or security key. Add one for a stronger sign-in option and device verification.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable accessibilityRole="button" haptic onPress={() => router.push({ pathname: '/settings', params: { section: 'account-security' } })}
            style={{ backgroundColor: theme.colors.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text variant="bodySmall" color={theme.colors.textOnAccent} style={{ fontWeight: '700' }}>Add passkey</Text>
          </Pressable>
          <Pressable accessibilityRole="button" haptic onPress={() => setDismissedAccountId(accountId)} style={{ padding: 8 }}>
            <Text variant="bodySmall" color={theme.colors.text2}>Later</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
