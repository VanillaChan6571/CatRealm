/**
 * Index route — decides whether the user lands in the app or the auth flow.
 * Auth state is already hydrated by `_layout.tsx` before this renders.
 */

import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function Index() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  if (!token || !user) return <Redirect href="/(auth)/welcome" />;

  return <Redirect href="/(app)/(tabs)/home" />;
}
