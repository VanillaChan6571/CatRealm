import { decideGifAdNavigation, isHttpAdUrl } from '../gifAdNavigation';

const creative = 'https://ads.klipy.com/creative';
const destination = 'https://advertiser.example/landing';

describe('Klipy ad navigation', () => {
  it('keeps the creative and its initial redirects in the WebView', () => {
    expect(decideGifAdNavigation({ url: creative }, creative, false)).toBe('allow');
    expect(decideGifAdNavigation({ url: destination }, creative, false)).toBe('allow');
    expect(decideGifAdNavigation({ url: destination, navigationType: 'other' }, creative, true)).toBe('block');
    expect(decideGifAdNavigation({ url: destination, hasGesture: false }, creative, true)).toBe('block');
    expect(decideGifAdNavigation({ url: destination, hasTargetFrame: false, navigationType: 'other' }, creative, false)).toBe('block');
  });

  it('opens a destination only for native click or gesture navigation', () => {
    expect(decideGifAdNavigation({ url: destination, navigationType: 'click' }, creative, true)).toBe('open');
    expect(decideGifAdNavigation({ url: destination, hasGesture: true }, creative, true)).toBe('open');
    expect(decideGifAdNavigation({ url: destination, hasTargetFrame: false, isTopFrame: false, navigationType: 'click' }, creative, true)).toBe('open');
  });

  it('does not open iframe navigation or non-web URLs', () => {
    expect(decideGifAdNavigation({ url: destination, isTopFrame: false, hasGesture: true }, creative, true)).toBe('allow');
    expect(decideGifAdNavigation({ url: 'intent://app', hasGesture: true }, creative, true)).toBe('block');
    expect(decideGifAdNavigation({ url: 'javascript:alert(1)', navigationType: 'click' }, creative, true)).toBe('block');
    expect(isHttpAdUrl('javascript:alert(1)')).toBe(false);
  });
});
