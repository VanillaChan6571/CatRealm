import { describe, expect, it } from 'vitest';
import { getRadioOffsetSeconds } from '../catRealmRadio';

const TWO_HOURS = 7200;
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 15, h, m, s);

describe('getRadioOffsetSeconds', () => {
  it('maps 03:26 local to 01:26:00 into a 2h track', () => {
    expect(getRadioOffsetSeconds(at(3, 26), TWO_HOURS)).toBe(1 * 3600 + 26 * 60);
  });

  it('starts at the top of the track on every even hour', () => {
    expect(getRadioOffsetSeconds(at(0, 0), TWO_HOURS)).toBe(0);
    expect(getRadioOffsetSeconds(at(14, 0), TWO_HOURS)).toBe(0);
  });

  it('covers the last second before midnight', () => {
    expect(getRadioOffsetSeconds(at(23, 59, 59), TWO_HOURS)).toBe(TWO_HOURS - 1);
  });

  it('falls back to 0 for an unknown duration', () => {
    expect(getRadioOffsetSeconds(at(3, 26), NaN)).toBe(0);
    expect(getRadioOffsetSeconds(at(3, 26), 0)).toBe(0);
  });
});
