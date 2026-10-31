import { packBytes, packFiles, pairFiles } from '../models';

describe('language pack models', () => {
  it('resolves direct pairs to mirrored, hash-pinned files', () => {
    const files = pairFiles('ru', 'en')!;
    expect(files.model.url).toMatch(/^https:\/\/catrealm\.app\/lang\/ru\/\d+\/model\.ruen\./);
    expect(files.model.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(files.vocabs).toHaveLength(1);
  });

  it('passes separate source and target vocabs for en→ja, in that order', () => {
    expect(pairFiles('en', 'ja')!.vocabs.map((file) => file.url.split('/').pop())).toEqual(['srcvocab.enja.spm', 'trgvocab.enja.spm']);
  });

  it('has no direct model between two non-English languages', () => {
    expect(pairFiles('ru', 'es')).toBeNull();
  });

  it('counts the shared Spanish vocab once', () => {
    expect(packFiles('es')).toHaveLength(5);
    expect(packBytes('es')).toBe(packFiles('es').reduce((sum, file) => sum + file.size, 0));
  });
});
