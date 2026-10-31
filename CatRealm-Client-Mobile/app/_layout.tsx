/**
 * Root layout — app entrypoint. Wraps the navigation tree with theme + safe
 * area + gesture providers, hydrates auth, then defers to expo-router's stack.
 *
 * The `(auth)` group renders when no session is present, the `(app)` group
 * renders the tab bar + nested stacks once signed in.
 */

import '@/lib/livekit-init';
import '@/i18n';
import { useCallback, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { View } from 'react-native';
import { ThemeProvider, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useChannelStore } from '@/stores/channelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useServerStore } from '@/stores/serverStore';
import { Text, Pressable } from '@/components';
import { LaunchReveal, LAUNCH_BACKGROUND } from '@/components/LaunchReveal';
import { startMemoryDiagnostics } from '@/lib/memoryDiagnostics';
import { OverlayProvider } from '@/components/OverlayPortal';

const ROOT_BACKGROUND = LAUNCH_BACKGROUND;

export default function RootLayout() {
  useEffect(() => startMemoryDiagnostics(), []);
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(ROOT_BACKGROUND);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: ROOT_BACKGROUND }}>
      <SafeAreaProvider style={{ backgroundColor: ROOT_BACKGROUND }}>
        <ThemeProvider>
          <OverlayProvider>
            <RootLayoutInner />
          </OverlayProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutInner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [hydrated, setHydrated] = useState(false);
  const [launchDone, setLaunchDone] = useState(false);
  const finishLaunch = useCallback(() => setLaunchDone(true), []);
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const signOut = useAuthStore((s) => s.signOut);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const centralSessionExpired = useAuthStore((s) => s.centralSessionExpired);
  const selectedTheme = useSettingsStore((s) => s.theme);
  const hydrateServers = useServerStore((s) => s.hydrate);
  const hydrateChannels = useChannelStore((s) => s.hydrate);
  const inLimbo = hydrated && ((Boolean(token) && !user) || (!token && Boolean(user)) || centralSessionExpired);
  const showLimboBanner = inLimbo;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrate();
      await hydrateSettings();
      const { user, token } = useAuthStore.getState();
      if (token && user) {
        await Promise.all([
          hydrateServers(user.id),
          hydrateChannels(user.id),
        ]);
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate, hydrateChannels, hydrateServers, hydrateSettings]);

  useEffect(() => {
    if (!hydrated || !token || !user?.id) return;
    void Promise.all([
      hydrateServers(user.id),
      hydrateChannels(user.id),
    ]);
  }, [hydrated, hydrateChannels, hydrateServers, token, user?.id]);

  // The launch screen continues the native splash and stays on top until its
  // reveal finishes; the app mounts underneath as soon as it is hydrated. Keep
  // it at one position in this tree: moving it remounted it mid-animation.
  return (
    <View style={{ flex: 1, backgroundColor: ROOT_BACKGROUND }}>
      {hydrated && <>
      <StatusBar style={selectedTheme === 'angel-cat' ? 'dark' : 'light'} />
      {showLimboBanner ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            paddingTop: insets.top + theme.spacing.xs,
            paddingBottom: theme.spacing.xs,
            paddingHorizontal: theme.spacing.md,
            backgroundColor: theme.colors.warning ?? '#9a3412',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
            <Text variant="bodySmall" color={theme.colors.textOnAccent} style={{ flex: 1 }}>
              Your currently in a limbo, manually sign out if auto sign out has failed
            </Text>
            <Pressable
              onPress={() => {
                void signOut();
              }}
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 6,
                borderRadius: theme.radius.sm,
                backgroundColor: 'rgba(0,0,0,0.22)',
              }}
            >
              <Text variant="bodySmall" color={theme.colors.textOnAccent}>
                Sign out now
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: ROOT_BACKGROUND },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      </Stack>
      </>}
      {!launchDone && <LaunchReveal ready={hydrated} onDone={finishLaunch} />}
    </View>
  );
}
