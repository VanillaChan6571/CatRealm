export function isTheaterVoiceDisconnected(user: { voiceConnected?: boolean }) {
  // Missing on older clients/servers: muted alone does not mean disconnected.
  return user.voiceConnected === false;
}
