import { describe, expect, it } from 'vitest';
import { getServerAvatarOverride } from '../serverProfileAvatar';

describe('server avatar override', () => {
  it('treats a default or synced URL as inherited', () => {
    expect(getServerAvatarOverride({ avatar: 'https://catrealm.app/uploads/avatars/default.jpg' })).toBeNull();
    expect(getServerAvatarOverride({ avatar: 'https://auth.example/avatars/new.png' })).toBeNull();
    expect(getServerAvatarOverride({ avatar: '/uploads/avatars/default-v2.jpg' })).toBeNull();
  });

  it('recognizes actual local uploads and respects the realm override flag', () => {
    expect(getServerAvatarOverride({ avatar: '/uploads/avatars/upload.png' })).toBe('/uploads/avatars/upload.png');
    expect(getServerAvatarOverride({ avatar: '/uploads/avatars/default-v2.jpg', avatar_override: false })).toBeNull();
    expect(getServerAvatarOverride({ avatar: '/uploads/avatars/upload.png', avatar_override: true })).toBe('/uploads/avatars/upload.png');
  });
});
