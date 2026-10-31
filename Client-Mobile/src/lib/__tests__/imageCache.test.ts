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
