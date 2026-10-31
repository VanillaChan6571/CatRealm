import { resolveAppLanguage } from './languages';

describe('resolveAppLanguage', () => {
  test('uses the first supported device locale and handles regional tags', () => {
    expect(resolveAppLanguage(['de-DE', 'es-MX', 'en-US'])).toBe('es');
    expect(resolveAppLanguage(['ja_JP'])).toBe('ja');
  });

  test('falls back to English', () => {
    expect(resolveAppLanguage(['de-DE'])).toBe('en');
  });
});
