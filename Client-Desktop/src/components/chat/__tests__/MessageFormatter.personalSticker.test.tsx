import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_BASE } from '../../../lib/authApi';
import { useAuthStore } from '../../../stores/authStore';
import { useServerStore } from '../../../stores/serverStore';
import { personalLookupCache } from '../../../messaging/chatlib/messageTokenParser';
import { MessageFormatter } from '../MessageFormatter';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  personalLookupCache.clear();
});

it('loads an ownerless personal sticker token for the signed-in user', async () => {
  const origin = new URL(AUTH_BASE).origin;
  const assetUrl = `${origin}/uploads/personal-expressions/stickers/noonelikes.webp`;
  const personalManifestUrl = `${origin}/api/profile/user123/personal-expressions/manifest`;
  const fetchManifest = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === personalManifestUrl ? ({
      emotes: [],
      'anim-emotes': [],
      stickers: [{ name: 'noonelikes', file_url: '/uploads/personal-expressions/stickers/noonelikes.webp' }],
      'anim-stickers': [],
    }) : ({ emotes: [], 'anim-emotes': [], stickers: [], 'anim-stickers': [] }),
  }));
  vi.stubGlobal('fetch', fetchManifest);
  useAuthStore.setState({ user: { id: 'user123', accountType: 'central' }, serverUrl: AUTH_BASE } as never);
  useServerStore.setState({ activeServerUrl: 'https://realm.example' } as never);

  render(<MessageFormatter text=":sticker:noonelikes:" />);

  await waitFor(() => expect(fetchManifest).toHaveBeenCalledWith(
    personalManifestUrl,
    { credentials: 'omit' },
  ));
  expect((await screen.findByRole('img', { name: 'noonelikes' })).getAttribute('src')).toBe(assetUrl);
});
