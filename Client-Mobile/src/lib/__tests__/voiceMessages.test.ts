jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 } } }));

import { VOICE_EXPIRY_OPTIONS, VOICE_RECORDING_NAME, VOICE_RECORDING_OPTIONS, canPlayVoiceOn, formatVoiceDuration, isAudioAttachment } from '../voiceMessages';

test('desktop voice notes classify as audio, not video', () => {
  expect(isAudioAttachment({ url: '/ugc/images/abc.webm', mime: 'audio/webm', name: null })).toBe(true);
  expect(isAudioAttachment({ url: '/ugc/images/abc.webm', mime: null, name: 'voice-message.webm' })).toBe(true);
  expect(isAudioAttachment({ url: '/ugc/images/clip.webm', mime: 'video/webm', name: null })).toBe(false);
  expect(isAudioAttachment({ url: '/ugc/images/clip.webm', mime: null, name: null })).toBe(false);
  expect(isAudioAttachment({ url: '/dm/a.m4a?sig=1', mime: null, name: null })).toBe(true);
});

test('iOS refuses WebM/Ogg voice notes; Android plays everything', () => {
  expect(canPlayVoiceOn('ios', 'audio/webm', '/a.webm')).toBe(false);
  expect(canPlayVoiceOn('ios', 'audio/ogg;codecs=opus', '/a')).toBe(false);
  expect(canPlayVoiceOn('ios', null, '/a.webm?token=x')).toBe(false);
  expect(canPlayVoiceOn('ios', 'audio/mp4', '/a.m4a')).toBe(true);
  expect(canPlayVoiceOn('android', 'audio/webm', '/a.webm')).toBe(true);
});

test('mobile records mono AAC with a real .m4a extension', () => {
  expect(VOICE_RECORDING_NAME).toMatch(/\.m4a$/);
  expect(VOICE_RECORDING_OPTIONS).toMatchObject({ extension: '.m4a', numberOfChannels: 1, isMeteringEnabled: true });
});

test('expiry choices match desktop and end with keep-forever', () => {
  expect(VOICE_EXPIRY_OPTIONS.map((o) => o.ms)).toEqual([1800000, 259200000, 604800000, 1209600000, 2592000000, null]);
});

test('formats durations as m:ss', () => {
  expect(formatVoiceDuration(0)).toBe('0:00');
  expect(formatVoiceDuration(65.9)).toBe('1:05');
  expect(formatVoiceDuration(Number.NaN)).toBe('0:00');
});
