import { describe, expect, it } from 'vitest';
import { getPreferredRtcE2eeMode, resolveSignaledRtcE2eeMode } from '../rtcE2eeMode';

describe('getPreferredRtcE2eeMode', () => {
  it('returns encrypted only when the local client can actually use e2ee', () => {
    expect(getPreferredRtcE2eeMode({ supported: true, userEnabled: true })).toBe('encrypted');
    expect(getPreferredRtcE2eeMode({ supported: false, userEnabled: true })).toBe('plaintext');
    expect(getPreferredRtcE2eeMode({ supported: true, userEnabled: false })).toBe('plaintext');
    expect(getPreferredRtcE2eeMode({ supported: true, userEnabled: true, downgraded: true })).toBe('plaintext');
  });
});

describe('resolveSignaledRtcE2eeMode', () => {
  it('does not let a remote encrypted signal override a local plaintext peer', () => {
    expect(resolveSignaledRtcE2eeMode({
      signaled: true,
      existingMode: 'plaintext',
      localPreferredMode: 'plaintext',
    })).toBe('plaintext');
  });

  it('accepts remote encrypted mode when the local peer is configured for e2ee', () => {
    expect(resolveSignaledRtcE2eeMode({
      signaled: true,
      existingMode: 'plaintext',
      localPreferredMode: 'encrypted',
    })).toBe('encrypted');
  });

  it('forces plaintext when the remote side explicitly disables e2ee', () => {
    expect(resolveSignaledRtcE2eeMode({
      signaled: false,
      existingMode: 'encrypted',
      localPreferredMode: 'encrypted',
    })).toBe('plaintext');
  });

  it('preserves the existing mode when no signal is present', () => {
    expect(resolveSignaledRtcE2eeMode({
      existingMode: 'encrypted',
      localPreferredMode: 'plaintext',
    })).toBe('encrypted');
  });
});
