import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLD,
  detectLanguage,
  isTranslatableText,
  planTranslation,
  scoreToConfidence,
} from '../detect';

const SPANISH = 'Hola, ¿cómo estás? Espero que todo vaya bien en el trabajo.';
const ENGLISH = 'Hey, how are you doing today? Hope work is going well for you.';

// Casual chat Spanish that franc-min misread as Portuguese/French or scored near zero.
const CHATTY_SPANISH = [
  'que onda wey como estas',
  'oye ya llegaste a la casa?',
  'tengo hambre vamos a comer algo',
  'neta no se que hacer con mi vida jaja',
  'estoy jugando ahorita con mis primos',
  'perdon no vi tu mensaje',
  'mi mama dice que no puedo salir hoy',
  'te quiero mucho hermano',
  'no tengo dinero para eso',
  'puedes venir a mi casa',
  'el servidor esta caido otra vez',
];

describe('isTranslatableText', () => {
  it('accepts ordinary sentences', () => {
    expect(isTranslatableText(SPANISH)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', 'hola'],
    ['emoji only', '😂😂😂🔥🔥🔥👍👍👍👍👍👍👍'],
    ['only a link', 'https://example.com/un-video-muy-largo'],
    ['only a mention and emote', '@carlosgonzalez :catdance:'],
    ['only code', '```\nconst saludo = "hola mundo";\n```'],
  ])('skips %s', (_label, text) => {
    expect(isTranslatableText(text)).toBe(false);
  });

  it.each([
    ['mentions', '@carlos ¿vienes a la fiesta esta noche?'],
    ['links', 'mira este video que encontré https://example.com/video'],
    ['emote tokens', 'me encanta esta canción :catdance: de verdad'],
    ['quotes', '> did you finish the homework?\nsí, ya terminé la tarea de matemáticas'],
  ])('still translates the prose around %s', (_label, text) => {
    expect(isTranslatableText(text)).toBe(true);
  });
});

describe('detectLanguage', () => {
  it('detects Spanish and English with high confidence', () => {
    expect(detectLanguage(SPANISH)).toMatchObject({ lang: 'es' });
    expect(detectLanguage(SPANISH)!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    expect(detectLanguage(ENGLISH)).toMatchObject({ lang: 'en' });
  });

  it.each(CHATTY_SPANISH)('detects casual Spanish reliably: %s', (text) => {
    const detected = detectLanguage(text);
    expect(detected?.lang).toBe('es');
    expect(detected!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it.each([
    "Bonjour, comment ça va aujourd'hui mon ami? J'espère que tout va bien.",
    'eu não sei o que fazer hoje',
    'obrigado por tudo meu amigo',
    'Ciao, come stai? Andiamo a giocare stasera',
  ])('returns null for languages the engine cannot translate: %s', (text) => {
    expect(detectLanguage(text)).toBeNull();
  });

  it('ignores the mention and the quoted English when detecting a reply', () => {
    expect(detectLanguage('@Johnny_Smith > see you tomorrow then\n¿a qué hora nos vemos mañana?')).toMatchObject({ lang: 'es' });
    expect(detectLanguage('> see you tomorrow then everyone\n¿a qué hora nos vemos mañana?')).toMatchObject({ lang: 'es' });
  });
});

describe('scoreToConfidence', () => {
  it('keeps unreliable detections below the threshold and spreads reliable ones over 70–100%', () => {
    expect(scoreToConfidence(false, 1)).toBeLessThan(CONFIDENCE_THRESHOLD);
    expect(scoreToConfidence(true, 0)).toBe(CONFIDENCE_THRESHOLD);
    expect(scoreToConfidence(true, 0.05)).toBeLessThan(scoreToConfidence(true, 0.15));
    expect(scoreToConfidence(true, 5)).toBe(1);
  });
});

describe('planTranslation', () => {
  it('translates Spanish for an English reader', () => {
    expect(planTranslation(SPANISH, 'en')).toMatchObject({ from: 'es', to: 'en' });
  });

  it('translates English for a Spanish reader', () => {
    expect(planTranslation(ENGLISH, 'es')).toMatchObject({ from: 'en', to: 'es' });
  });

  it('leaves messages already in the reader language alone', () => {
    expect(planTranslation(SPANISH, 'es')).toBeNull();
    expect(planTranslation(ENGLISH, 'en')).toBeNull();
  });

  it('respects the confidence threshold', () => {
    const plan = planTranslation(SPANISH, 'en');
    expect(plan).not.toBeNull();
    expect(planTranslation(SPANISH, 'en', undefined, plan!.confidence + 0.0001)).toBeNull();
  });

  it('translates mentions-plus-Spanish messages', () => {
    expect(planTranslation('@carlos ¿ya terminaste la tarea de matemáticas?', 'en')).toMatchObject({ from: 'es' });
  });
});

describe('Russian and Japanese', () => {
  const RUSSIAN = 'Привет, как у тебя дела сегодня? Пойдём вечером в кино?';
  const JAPANESE = '今夜、映画を見に行きませんか？';

  it('detects both', () => {
    expect(detectLanguage(RUSSIAN)).toMatchObject({ lang: 'ru' });
    expect(detectLanguage(JAPANESE)).toMatchObject({ lang: 'ja' });
  });

  it('counts kana and kanji double, so short Japanese still translates', () => {
    expect(isTranslatableText('おはようございます')).toBe(true);
    expect(isTranslatableText('はい')).toBe(false);
  });

  it('plans only between installed languages', () => {
    const installed = new Set(['en', 'ru'] as const);
    expect(planTranslation(RUSSIAN, 'en', installed)).toMatchObject({ from: 'ru', to: 'en' });
    expect(planTranslation(JAPANESE, 'en', installed)).toBeNull();
    // A Spanish reader needs the Spanish pack as well as the source language's.
    expect(planTranslation(RUSSIAN, 'es', installed)).toBeNull();
    expect(planTranslation(RUSSIAN, 'es', new Set(['en', 'ru', 'es'] as const))).toMatchObject({ from: 'ru', to: 'es' });
  });
});
