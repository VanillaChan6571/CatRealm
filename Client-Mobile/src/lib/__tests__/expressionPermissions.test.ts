import { filterExpressionLookup } from '../expressionPermissions';
import type { ExpressionLookup } from '../expressionCache';

const lookup: ExpressionLookup = new Map([
  ['realm', { name: 'realm', source: 'server', origin: 'https://realm.example', emote: '/realm.png', sticker: '/realm.webp' }],
  ['other', { name: 'other', source: 'server', origin: 'https://other.example', emote: '/other.png', sticker: '/other.webp' }],
  ['personal', { name: 'personal', source: 'personal', origin: 'https://auth.example', ownerId: 'me', emote: '/personal.png', sticker: '/personal.webp' }],
]);

test('keeps current realm expressions while excluding external expressions without permission', () => {
  const allowed = filterExpressionLookup(lookup, 'https://realm.example', false, false);
  expect([...allowed!.keys()]).toEqual(['realm']);
});

test('applies emote and sticker permissions separately', () => {
  const allowed = filterExpressionLookup(lookup, 'https://realm.example', true, false);
  expect(allowed?.get('other')).toMatchObject({ emote: '/other.png' });
  expect(allowed?.get('other')?.sticker).toBeUndefined();
  expect(allowed?.get('personal')?.sticker).toBeUndefined();
  expect(lookup.get('other')?.sticker).toBe('/other.webp');
});
