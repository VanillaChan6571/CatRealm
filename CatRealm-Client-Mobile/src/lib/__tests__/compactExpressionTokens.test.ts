import { compactExpressionTokens } from '../dmContext';

describe('compactExpressionTokens', () => {
  it('drops the realm origin from compact emote tokens', () => {
    expect(compactExpressionTokens('wdym :https://noonekoi.nekohosting.gg:40820:kyaruwoah:'))
      .toBe('wdym :kyaruwoah:');
    expect(compactExpressionTokens(':https://realm.example:sticker:wave:abc123:')).toBe(':wave:');
  });

  it('shows legacy expression tokens by name', () => {
    expect(compactExpressionTokens('hi [[emote:42|catjam]]')).toBe('hi :catjam:');
  });

  it('leaves plain URLs alone', () => {
    expect(compactExpressionTokens('see https://example.com:8080/x')).toBe('see https://example.com:8080/x');
  });
});
