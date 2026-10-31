export const CONNECT_TO_VOICE_PERMISSION_ERROR = 'Missing permission: connect_to_voice';
export const CONNECT_TO_VOICE_PERMISSION_MESSAGE =
  'You do not have permission to connect to this voice channel.';

export function isConnectToVoicePermissionError(value?: string | null): boolean {
  return (value ?? '').trim().toLowerCase() === CONNECT_TO_VOICE_PERMISSION_ERROR.toLowerCase();
}
