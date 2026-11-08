import { getCachedUri } from '../imageCache';

const mockReadDirectory = jest.fn(async () => [] as string[]);

jest.mock('expo-image', () => ({ Image: { clearMemoryCache: jest.fn(async () => {}) } }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/cache/',
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: path.endsWith('/'),
    isDirectory: path.endsWith('/'),
  })),
  makeDirectoryAsync: jest.fn(async () => {}),
  downloadAsync: jest.fn(async () => ({ status: 200 })),
  readDirectoryAsync: () => mockReadDirectory(),
  deleteAsync: jest.fn(async () => {}),
}));

test('a burst of image downloads triggers one cache cap scan', async () => {
  jest.useFakeTimers();
  try {
    await Promise.all([
      getCachedUri('https://example.com/one.png', 'Central/DMs'),
      getCachedUri('https://example.com/two.png', 'Central/DMs'),
      getCachedUri('https://example.com/three.png', 'Central/DMs'),
    ]);
    expect(mockReadDirectory).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(250);
    expect(mockReadDirectory).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('a zero-byte cached file is discarded and downloaded again', async () => {
  const FileSystem = jest.requireMock('expo-file-system/legacy');
  FileSystem.getInfoAsync.mockImplementationOnce(async () => ({ exists: true, isDirectory: true }));
  FileSystem.getInfoAsync.mockImplementationOnce(async () => ({ exists: true, size: 0 }));
  const uri = await getCachedUri('https://example.com/empty.png', 'Central/Zero');
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  expect(FileSystem.downloadAsync).toHaveBeenCalledWith('https://example.com/empty.png', uri);
});

test.each([
  ['https://example.com/v1.2/photo', /\.jpg$/],
  ['https://example.com/photo.php?id=1', /\.jpg$/],
  ['https://example.com/photo.WEBP#frag', /\.webp$/],
  ['https://example.com/clip.ogv', /\.ogv$/],
])('names the cache file for %s with a decodable extension', async (url, expected) => {
  expect(await getCachedUri(url, 'Central/Names')).toMatch(expected);
});
