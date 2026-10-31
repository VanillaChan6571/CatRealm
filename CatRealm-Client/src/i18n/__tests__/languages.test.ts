import { describe, expect, it } from 'vitest';
import { resolveAppLanguage } from '../languages';

describe('resolveAppLanguage', () => {
  it('uses the first supported browser locale and handles regional tags', () => {
    expect(resolveAppLanguage(['de-DE', 'ja-JP', 'en-US'])).toBe('ja');
    expect(resolveAppLanguage(['ru_RU'])).toBe('ru');
  });

  it('falls back to English', () => {
    expect(resolveAppLanguage(['de-DE'])).toBe('en');
  });
});
