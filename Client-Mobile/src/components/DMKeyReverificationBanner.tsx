import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Pressable, Text } from '@/components';
import { useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDMKeyReverificationStore } from '@/stores/dmKeyReverificationStore';
import { verifyCurrentDeviceForKeySharing } from '@/lib/verifyDeviceForKeySharing';
import { syncKnownConversationKeys } from '@/lib/dmKeyStore';

export function DMKeyReverificationBanner() {
  const theme = useTheme();
  const user = useAuthStore((state) => state.user);
  const accountSwitching = useAuthStore((state) => state.accountSwitching);
  const accountId = useDMKeyReverificationStore((state) => state.accountId);
  const waitingDeviceId = useDMKeyReverificationStore((state) => state.waitingDeviceId);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setVerified(false); setError(null); }, [user?.id, waitingDeviceId]);
  if (accountSwitching || user?.accountType !== 'central' || accountId !== user.id || !waitingDeviceId) return null;

  const handleVerify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!verified) {
        await verifyCurrentDeviceForKeySharing();
        setVerified(true);
      }
      await syncKnownConversationKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify this device. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.bgElev1, borderBottomWidth: 1, borderBottomColor: theme.colors.accent }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        <Text variant="body" color={theme.colors.text} style={{ fontWeight: '700' }}>
          {verified ? 'Device verified. DM key sync is still pending.' : 'Verify this device to sync DM keys'}
        </Text>
        <Text variant="bodySmall" color={theme.colors.text2}>
          {verified
            ? 'Your passkey proof succeeded. Try syncing again if the other device is still waiting.'
            : 'You recently signed in on another device and trusted it with a passkey. This device holds your DM keys, but its passkey proof has expired. Verify it to share the keys.'}
        </Text>
        {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          haptic
          disabled={busy}
          onPress={() => void handleVerify()}
          style={{ alignSelf: 'flex-start', backgroundColor: theme.colors.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text variant="bodySmall" color={theme.colors.textOnAccent} style={{ fontWeight: '700' }}>
            {busy ? (verified ? 'Syncing…' : 'Verifying…') : (verified ? 'Retry sync' : 'Verify')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
