type ServerAvatarProfile = {
  avatar?: string | null;
  avatar_override?: boolean;
};

/** Realm-synced and default URLs are inherited; only local uploads are overrides. */
export function getServerAvatarOverride(profile: ServerAvatarProfile): string | null {
  const avatar = typeof profile.avatar === 'string' ? profile.avatar : null;
  if (!avatar) return null;
  if (typeof profile.avatar_override === 'boolean') return profile.avatar_override ? avatar : null;
  // Older realms do not expose avatar_override. Their uploaded avatars use a
  // relative path, while the built-in default and Central avatars are URLs.
  return avatar.startsWith('/uploads/avatars/')
    && !/^\/uploads\/avatars\/default(?:-v2)?\.jpg$/i.test(avatar)
    ? avatar
    : null;
}
