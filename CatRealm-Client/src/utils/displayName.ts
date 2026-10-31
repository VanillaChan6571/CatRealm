import { nicknameScope, useNicknamesStore } from '../stores/nicknamesStore';

export function resolveDisplayName(
  userId: string,
  username: string,
  displayName?: string | null,
  useNickname: boolean = true
): string {
  // Priority: private nickname → display_name → username
  if (useNickname) {
    const nickname = useNicknamesStore.getState().byScope[nicknameScope()]?.[userId];
    if (nickname) return nickname;
  }

  return displayName || username;
}
