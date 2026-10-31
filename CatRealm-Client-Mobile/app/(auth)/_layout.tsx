/**
 * Auth stack — pre-login flows: welcome, central login/register, server
 * connect, 2FA verify, and local account login/register. All screens here
 * are wired against `lib/api.ts` (authApi) + `stores/authStore.ts`.
 */

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { AuthBackdrop } from '@/components';

// The stack's native container is painted with the navigation theme's
// colors.background, a layer behind the screens that contentStyle cannot reach.
// It defaults to DefaultTheme's light #F2F2F2, which lands between AuthBackdrop
// and the screens and hides the starfield, so the transparency has to come from
// the theme rather than screenOptions.
const TRANSPARENT_NAV_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent' },
};

export default function AuthLayout() {
  return (
    <AuthBackdrop>
      <ThemeProvider value={TRANSPARENT_NAV_THEME}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        >
          <Stack.Screen name="welcome" />
          <Stack.Screen name="central-login" />
          <Stack.Screen name="central-register" />
          <Stack.Screen name="connect-server" />
          <Stack.Screen name="verify-2fa" />
          <Stack.Screen name="local-login" />
          <Stack.Screen name="local-register" />
        </Stack>
      </ThemeProvider>
    </AuthBackdrop>
  );
}
