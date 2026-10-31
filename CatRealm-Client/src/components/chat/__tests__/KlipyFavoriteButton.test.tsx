import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KlipyFavoriteButton } from '../KlipyFavoriteButton';
import { useAuthStore } from '../../../stores/authStore';
import { useGifFavoritesStore } from '../../../stores/gifFavoritesStore';

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('../../../lib/gifApi', () => ({
  getGifFavorites: api.list, saveGifFavorite: api.save, removeGifFavorite: api.remove,
}));

const url = 'https://static.klipy.com/ii/abc/cat.gif';

beforeEach(() => {
  useAuthStore.setState({ user: { accountType: 'central' } } as never);
  useGifFavoritesStore.setState({ favorites: [], loaded: false, loading: false, error: null, busy: new Set() });
  api.list.mockResolvedValue([]);
  api.save.mockImplementation(async (item, product) => ({ ...item, product, createdAt: 1 }));
  api.remove.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('stars a chat Klipy GIF by URL and unstars it', async () => {
  render(<KlipyFavoriteButton url={url} />);
  await waitFor(() => expect(api.list).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ id: url, url, previewUrl: url }), 'gifs'));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove from favorites' }));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith(url, 'gifs'));
});

it('recognizes a GIF already starred from the picker and removes it by its Klipy id', async () => {
  api.list.mockResolvedValue([{ kind: 'gif', id: 'klipy-42', url, previewUrl: url, title: '', width: null, height: null, product: 'gifs', createdAt: 1 }]);
  render(<KlipyFavoriteButton url={url} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove from favorites' }));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('klipy-42', 'gifs'));
});

it('renders nothing for non-Klipy media or non-Central accounts', () => {
  const { container, rerender } = render(<KlipyFavoriteButton url="https://example.com/cat.gif" />);
  expect(container.innerHTML).toBe('');
  useAuthStore.setState({ user: { accountType: 'local' } } as never);
  rerender(<KlipyFavoriteButton url={url} />);
  expect(container.innerHTML).toBe('');
});
