import { Platform } from 'react-native';

type PlatformConstants = { Manufacturer?: string; Brand?: string };

/** True on Samsung-made Android devices (Galaxy phones and tablets). */
export function isSamsungAndroid(
  os: string = Platform.OS,
  constants: PlatformConstants = (Platform.constants ?? {}) as PlatformConstants,
): boolean {
  if (os !== 'android') return false;
  return [constants.Manufacturer, constants.Brand].some((value) => value?.trim().toLowerCase() === 'samsung');
}

/**
 * Default for "Smooth image loading". On Samsung Android, expo-image can draw a
 * chat image or banner and then fade it out to nothing when it resizes right
 * after loading (seen on a Galaxy S23 Ultra, Android 16), so it starts off there.
 */
export function defaultSmoothImageLoading(
  os: string = Platform.OS,
  constants?: PlatformConstants,
): boolean {
  return !isSamsungAndroid(os, constants);
}

/**
 * Props for large images (chat attachments, banners). With smooth loading off
 * on Android there is no fade and no re-fetch on resize, so a second load
 * cannot replace a picture that has already been drawn.
 */
export function imageLoadingProps(
  smooth: boolean,
  transition: number,
  os: string = Platform.OS,
): { transition: number; allowDownscaling: boolean } {
  if (os === 'android' && !smooth) return { transition: 0, allowDownscaling: false };
  return { transition, allowDownscaling: true };
}
