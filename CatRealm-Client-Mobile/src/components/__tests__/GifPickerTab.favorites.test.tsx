import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { GifPickerTab } from '../GifPickerTab';

jest.mock('@/lib/gifApi', () => ({
  trendingGifs: jest.fn(), searchGifs: jest.fn(), getGifFavorites: jest.fn(),
  saveGifFavorite: jest.fn(), removeGifFavorite: jest.fn(),
}));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('lucide-react-native', () => ({ Star: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {
  accent: '#fff', accentSoft: '#333', bgElev2: '#222', text: '#fff', text2: '#ccc', text3: '#aaa', lineSoft: '#555',
} }) }));

const gifApi = jest.requireMock('@/lib/gifApi');
const mockApi = {
  trending: gifApi.trendingGifs as jest.Mock,
  list: gifApi.getGifFavorites as jest.Mock,
  save: gifApi.saveGifFavorite as jest.Mock,
  remove: gifApi.removeGifFavorite as jest.Mock,
};

const cat = {
  kind: 'gif', id: 'cat-1', url: 'https://static.klipy.com/cat.gif',
  previewUrl: 'https://static.klipy.com/cat.webp', title: 'Cat GIF', width: 100, height: 100,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.trending.mockResolvedValue({ results: [cat], next: null });
  mockApi.list.mockResolvedValue([]);
  mockApi.save.mockResolvedValue({ ...cat, product: 'gifs', createdAt: 1 });
  mockApi.remove.mockResolvedValue(undefined);
});

test('stars a GIF and uses the synced Favorites view', async () => {
  const onSelect = jest.fn();
  const screen = await render(<GifPickerTab width={390} onSelect={onSelect} />);
  await waitFor(() => expect(screen.getByLabelText('chat.gifAddFavorite')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('chat.gifAddFavorite'));
  await waitFor(() => expect(mockApi.save).toHaveBeenCalledWith(cat, 'gifs'));
  await fireEvent.press(screen.getByText('chat.gifFavorites'));
  await fireEvent.press(screen.getByLabelText('chat.gifRemoveFavorite'));
  await waitFor(() => expect(screen.getByText('chat.gifFavoritesEmpty')).toBeTruthy());
  expect(mockApi.remove).toHaveBeenCalledWith('cat-1', 'gifs');
});
