import { theaterLayout, theaterYouTubeFrame } from '../theaterLayout';

test.each([[932, 430], [926, 428], [640, 180], [430, 932], [320, 180], [184, 104]])(
  'YouTube fits entirely inside %i x %i without cropping or distortion', (width, height) => {
    const frame = theaterYouTubeFrame(width, height);
    expect(frame.width).toBeLessThanOrEqual(width);
    expect(frame.height).toBeLessThanOrEqual(height);
    expect(frame.width / frame.height).toBeCloseTo(16 / 9);
    expect(frame.width === width || Math.abs(frame.height - height) < 0.0001).toBe(true);
  },
);

test.each([[0, 430], [932, 0], [-10, 180], [NaN, 180], [320, Infinity]])(
  'YouTube handles an unmeasured stage %s x %s', (width, height) => {
    expect(theaterYouTubeFrame(width, height)).toEqual({ width: 0, height: 0 });
  },
);

test.each([[926, 300], [932, 290], [844, 270], [1024, 640]])('landscape %i x %i keeps playback controls inside the body', (width, height) => {
  const layout = theaterLayout(width, height, 112, false);
  expect(layout.playerWidth + layout.sidebarWidth).toBe(width);
  expect(layout.playerHeight + 112).toBeLessThanOrEqual(height);
  expect(layout.split).toBe(true);
});
test('wide landscape dimensions do not implicitly enable fullscreen', () => {
  const layout = theaterLayout(932, 430, 112, false);
  expect(layout.playerHeight).toBeLessThan(430);
  const fullscreen = theaterLayout(932, 430, 112, true);
  expect(fullscreen).toEqual({ split: false, sidebarWidth: 0, playerWidth: 932, playerHeight: 430 });
});
test('portrait leaves room for the queue instead of overlapping controls', () => {
  const layout = theaterLayout(428, 650, 112, false);
  expect(layout.split).toBe(false);
  expect(layout.playerHeight + 112 + 120).toBeLessThanOrEqual(650);
});
