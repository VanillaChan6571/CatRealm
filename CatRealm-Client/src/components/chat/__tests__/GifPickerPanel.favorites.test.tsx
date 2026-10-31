import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GifPickerPanel } from '../GifPickerPanel';

const api = vi.hoisted(() => ({
  trending: vi.fn(), search: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn(),
}));
vi.mock('../../../lib/gifApi', () => ({
  trendingGifs: api.trending, searchGifs: api.search, getGifFavorites: api.list,
  saveGifFavorite: api.save, removeGifFavorite: api.remove,
}));

const cat = {
  kind: 'gif' as const, id: 'cat-1', url: 'https://static.klipy.com/cat.gif',
  previewUrl: 'https://static.klipy.com/cat.webp', title: 'Cat GIF', width: 100, height: 100,
};

beforeEach(() => {
  api.trending.mockResolvedValue({ results: [cat], next: null });
  api.list.mockResolvedValue([]);
  api.save.mockResolvedValue({ ...cat, product: 'gifs', createdAt: 1 });
  api.remove.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('saves a searched GIF, shows it under Favorites, and removes it', async () => {
  const onSelect = vi.fn();
  render(<GifPickerPanel onSelect={onSelect} />);
  await screen.findByAltText('Cat GIF');
  fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(cat, 'gifs'));
  fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
  expect(screen.getByAltText('Cat GIF')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Cat GIF'));
  expect(onSelect).toHaveBeenCalledWith(cat.url);
  fireEvent.click(screen.getByRole('button', { name: 'Remove from favorites' }));
  await waitFor(() => expect(screen.getByText(/No favorites yet/)).toBeTruthy());
  expect(api.remove).toHaveBeenCalledWith('cat-1', 'gifs');
});
