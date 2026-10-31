import { beforeEach, describe, expect, it, vi } from 'vitest';

const bergamot = vi.hoisted(() => vi.fn(async (text: string) => `EN(${text})`));
const chrome = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));

vi.mock('../bergamotEngine', () => ({
  translateWithBergamot: bergamot,
  shutdownEngine: vi.fn(),
}));
vi.mock('../chromeTranslator', () => ({ translateWithChrome: chrome }));

import { clearTranslationCache, forceTranslateMessage, peekTranslation, translateMessage, useTranslationPacks } from '../index';

const SPANISH = '¿Vienes a la fiesta esta noche? Va a estar muy divertida.';

describe('translateMessage', () => {
  beforeEach(() => {
    useTranslationPacks.setState({ installed: ['es'] });
    clearTranslationCache();
    bergamot.mockClear();
    chrome.mockClear();
  });

  it('translates Spanish for an English reader with detection confidence', async () => {
    const result = await translateMessage('m1', SPANISH, 'en');
    expect(result).toMatchObject({ text: `EN(${SPANISH})`, from: 'es', to: 'en' });
    expect(result!.confidence).toBeGreaterThan(0.7);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });

  it('caches by message id so the engine runs once', async () => {
    await translateMessage('m1', SPANISH, 'en');
    await translateMessage('m1', SPANISH, 'en');
    expect(bergamot).toHaveBeenCalledTimes(1);
    expect(peekTranslation('m1', SPANISH, 'en')).toMatchObject({ from: 'es' });
  });

  it('does not translate messages already in the reader language', async () => {
    expect(await translateMessage('m1', SPANISH, 'es')).toBeNull();
    expect(bergamot).not.toHaveBeenCalled();
    expect(peekTranslation('m1', SPANISH, 'es')).toBeNull();
  });

  it('prefers the browser built-in translator when it is available', async () => {
    chrome.mockResolvedValueOnce('Are you coming to the party tonight?');
    const result = await translateMessage('m2', SPANISH, 'en');
    expect(result?.text).toBe('Are you coming to the party tonight?');
    expect(bergamot).not.toHaveBeenCalled();
  });

  it('auto-translates around mentions and links, keeping them intact', async () => {
    const result = await translateMessage('m7', '@ana ¿vienes a la fiesta esta noche? https://x.test/a', 'en');
    expect(result?.text).toBe('@ana EN(¿vienes a la fiesta esta noche?) https://x.test/a');
  });

  it('force-translates a message auto-translate skipped, keeping links intact', async () => {
    const text = 'hola mira https://x.test/a';
    expect(await translateMessage('m5', text, 'en')).toBeNull();
    const result = await forceTranslateMessage('m5', text, 'en');
    expect(result).toMatchObject({ text: 'EN(hola mira) https://x.test/a', from: 'es', to: 'en' });
    expect(peekTranslation('m5', text, 'en')).toEqual(result);
  });

  it('omits confidence when the detector disagrees with a forced direction', async () => {
    const result = await forceTranslateMessage('m6', 'Can someone help me set up the voice channel please?', 'en');
    expect(result?.from).toBe('es');
    expect(result?.confidence).toBeNull();
  });
});

describe('language packs', () => {
  beforeEach(() => {
    useTranslationPacks.setState({ installed: ['es'] });
    clearTranslationCache();
    bergamot.mockClear();
  });

  it('skips languages whose pack is not installed', async () => {
    expect(await translateMessage('r1', 'Привет, как у тебя дела сегодня?', 'en')).toBeNull();
    expect(bergamot).not.toHaveBeenCalled();
  });

  it('retries cached misses once the pack is installed', async () => {
    const text = 'Привет, как у тебя дела сегодня?';
    expect(await translateMessage('r2', text, 'en')).toBeNull();
    useTranslationPacks.setState({ installed: ['es', 'ru'] });
    expect(await translateMessage('r2', text, 'en')).toMatchObject({ from: 'ru', to: 'en' });
  });

  it('cannot translate into a reader language whose pack is missing', async () => {
    useTranslationPacks.setState({ installed: ['ru'] });
    expect(await translateMessage('r3', 'Hey, how are you doing today? Hope work is going well.', 'es')).toBeNull();
    expect(await forceTranslateMessage('r3', 'hello there', 'es')).toBeNull();
  });
});
