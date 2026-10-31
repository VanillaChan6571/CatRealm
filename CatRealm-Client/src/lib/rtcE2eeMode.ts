export type RtcPeerE2eeMode = 'encrypted' | 'plaintext';

export function getPreferredRtcE2eeMode(options: {
  supported: boolean;
  userEnabled: boolean;
  downgraded?: boolean;
}): RtcPeerE2eeMode {
  return options.supported && options.userEnabled && !options.downgraded
    ? 'encrypted'
    : 'plaintext';
}

export function resolveSignaledRtcE2eeMode(options: {
  signaled?: boolean;
  existingMode?: RtcPeerE2eeMode;
  localPreferredMode: RtcPeerE2eeMode;
}): RtcPeerE2eeMode {
  if (options.signaled === false) return 'plaintext';
  if (options.signaled === true) {
    return options.localPreferredMode === 'encrypted' ? 'encrypted' : 'plaintext';
  }
  return options.existingMode ?? options.localPreferredMode;
}
