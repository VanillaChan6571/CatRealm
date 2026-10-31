import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildImmediateEmbed } from '../EmbedRenderers';

describe('PDF previews', () => {
  it('isolates arbitrary document responses and keeps an explicit open link available', () => {
    const url = 'https://documents.example.test/document.pdf';
    const element = buildImmediateEmbed(url);
    expect(element).not.toBeNull();
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(element!);
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(url);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(container.querySelector('a')?.href).toBe(url);
  });
});
