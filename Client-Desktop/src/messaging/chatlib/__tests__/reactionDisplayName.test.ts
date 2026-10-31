import { expect, it } from 'vitest';
import { reactionDisplayName } from '../messageTokenParser';

it('names custom emote and sticker reactions by their :name:', () => {
  expect(reactionDisplayName(':catjam:')).toBe(':catjam:');
  expect(reactionDisplayName(':sticker:wave:')).toBe(':wave:');
  expect(reactionDisplayName(':https://realm.example:3000:catjam:')).toBe(':catjam:');
  expect(reactionDisplayName(':https://auth.catrealm.app:sticker:reactive-idle:37e89fdf-9d2a-490d-95b6-2d78740d525a:'))
    .toBe(':reactive-idle:');
});

it('shows unicode reactions as-is', () => {
  expect(reactionDisplayName('😂')).toBe('😂');
  expect(reactionDisplayName('👍🏽')).toBe('👍🏽');
});
