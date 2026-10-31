import { describe, expect, it, vi } from 'vitest';
import { TranslationCache } from '../cache';

describe('TranslationCache', () => {
  it('distinguishes a miss (undefined) from a cached "no translation" (null)', () => {
    const cache = new TranslationCache<string>();
    expect(cache.get('m1', 'hola')).toBeUndefined();
    cache.set('m1', 'hola', null);
    expect(cache.get('m1', 'hola')).toBeNull();
  });

  it('invalidates an entry when the message text is edited', () => {
    const cache = new TranslationCache<string>();
    cache.set('m1', 'hola mundo', 'hello world');
    expect(cache.get('m1', 'hola mundo')).toBe('hello world');
    expect(cache.get('m1', 'hola mundo editado')).toBeUndefined();
  });

  it('evicts the least recently used entry', () => {
    const cache = new TranslationCache<string>(2);
    cache.set('a', 'a', 'A');
    cache.set('b', 'b', 'B');
    cache.get('a', 'a'); // a is now most recent
    cache.set('c', 'c', 'C');
    expect(cache.get('b', 'b')).toBeUndefined();
    expect(cache.get('a', 'a')).toBe('A');
    expect(cache.get('c', 'c')).toBe('C');
    expect(cache.size).toBe(2);
  });

  it('shares one in-flight load per message and caches the result', async () => {
    const cache = new TranslationCache<string>();
    const load = vi.fn(async () => 'hello');
    const [first, second] = await Promise.all([cache.resolve('m1', 'hola', load), cache.resolve('m1', 'hola', load)]);
    expect(first).toBe('hello');
    expect(second).toBe('hello');
    await cache.resolve('m1', 'hola', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures so a later view can retry', async () => {
    const cache = new TranslationCache<string>();
    const load = vi.fn().mockRejectedValueOnce(new Error('worker crashed')).mockResolvedValueOnce('hello');
    await expect(cache.resolve('m1', 'hola', load)).rejects.toThrow('worker crashed');
    await expect(cache.resolve('m1', 'hola', load)).resolves.toBe('hello');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
