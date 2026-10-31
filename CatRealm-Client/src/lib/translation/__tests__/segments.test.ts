import { describe, expect, it } from 'vitest';
import { proseOf, splitProtected, translateProse } from '../segments';

const upper = async (text: string) => text.toUpperCase();

describe('splitProtected', () => {
  it('separates links, mentions, code and emotes from prose', () => {
    const segments = splitProtected('hola @ana mira https://x.test/a y `npm i` :catdance: fin');
    expect(segments.filter((s) => s.protect).map((s) => s.text)).toEqual([
      '@ana',
      'https://x.test/a',
      '`npm i`',
      ':catdance:',
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('hola @ana mira https://x.test/a y `npm i` :catdance: fin');
  });

  it('keeps <@id> and <#id> mention tokens whole', () => {
    const text = '<#68deafc8-3147-43af-bc7b-2021c5cb432a> test <@u_1-2>';
    expect(splitProtected(text).filter((s) => s.protect).map((s) => s.text)).toEqual([
      '<#68deafc8-3147-43af-bc7b-2021c5cb432a>',
      '<@u_1-2>',
    ]);
  });

  it('keeps fenced code blocks whole', () => {
    const text = 'mira:\n```\nconst hola = 1;\n```\nlisto';
    expect(splitProtected(text).find((s) => s.protect)?.text).toBe('```\nconst hola = 1;\n```');
  });
});

describe('quotes', () => {
  it('protects "> " quote lines and ">>>" blocks', () => {
    expect(proseOf('> see you tomorrow\n¿a qué hora?')).toBe('¿a qué hora?');
    expect(proseOf('mira esto\n>>> everything\nafter is quoted')).toBe('mira esto');
  });

  it('does not treat ">" inside a sentence as a quote', () => {
    expect(proseOf('5 > 3 es verdad')).toBe('5 > 3 es verdad');
  });
});

describe('translateProse', () => {
  it('keeps quoted lines verbatim', async () => {
    await expect(translateProse('> see you\nnos vemos', upper)).resolves.toBe('> see you\nNOS VEMOS');
  });

  it('translates prose only and preserves protected tokens and spacing', async () => {
    await expect(translateProse('hola @ana, mira https://x.test/a ahora', upper)).resolves.toBe(
      'HOLA @ana, MIRA https://x.test/a AHORA',
    );
  });

  it('passes through segments without letters', async () => {
    await expect(translateProse('@ana 😂 !!', upper)).resolves.toBe('@ana 😂 !!');
  });
});
