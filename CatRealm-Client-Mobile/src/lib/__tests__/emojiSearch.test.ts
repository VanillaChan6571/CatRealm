import { searchEmoji } from '../emojiSearch';

test('matches names and tags, requiring every word', () => {
  const emojis = ['😂', '🙁', '☹️', '🐱', '❤️'];
  expect(searchEmoji(emojis, 'lol')).toEqual(['😂']);
  expect(searchEmoji(emojis, 'Frowning')).toEqual(['🙁', '☹️']);
  expect(searchEmoji(emojis, 'cat face')).toEqual(['🐱']);
  expect(searchEmoji(emojis, 'heart')).toEqual(['❤️']);
  expect(searchEmoji(emojis, 'zzzqqq')).toEqual([]);
  expect(searchEmoji(emojis, '  ')).toEqual(emojis);
});
