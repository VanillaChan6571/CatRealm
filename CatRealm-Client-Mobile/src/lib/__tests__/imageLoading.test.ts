import { defaultSmoothImageLoading, imageLoadingProps, isSamsungAndroid } from '../imageLoading';

test('recognises Samsung Android by manufacturer or brand', () => {
  expect(isSamsungAndroid('android', { Manufacturer: 'samsung', Brand: 'samsung' })).toBe(true);
  expect(isSamsungAndroid('android', { Manufacturer: 'Samsung' })).toBe(true);
  expect(isSamsungAndroid('android', { Brand: 'samsung' })).toBe(true);
  expect(isSamsungAndroid('android', { Manufacturer: 'Google', Brand: 'google' })).toBe(false);
  expect(isSamsungAndroid('ios', { Manufacturer: 'samsung' })).toBe(false);
});

test('turns smooth image loading off by default only on Samsung Android', () => {
  expect(defaultSmoothImageLoading('android', { Manufacturer: 'samsung' })).toBe(false);
  expect(defaultSmoothImageLoading('android', { Manufacturer: 'Google' })).toBe(true);
  expect(defaultSmoothImageLoading('ios', {})).toBe(true);
});

test('drops the fade and resize re-fetch only when smooth loading is off on Android', () => {
  expect(imageLoadingProps(false, 250, 'android')).toEqual({ transition: 0, allowDownscaling: false });
  expect(imageLoadingProps(true, 250, 'android')).toEqual({ transition: 250, allowDownscaling: true });
  expect(imageLoadingProps(false, 250, 'ios')).toEqual({ transition: 250, allowDownscaling: true });
});
