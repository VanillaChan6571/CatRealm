/**
 * Self-hosted voice channels identify people by that server's local user id, while
 * DM / group calls use central ids, so a person key is scoped to where the id
 * came from: `server:<origin>:<id>` or `central:<id>`.
 */
export function getOverlayPersonKey(id: string, voiceServerUrl: string | null): string {
  if (!voiceServerUrl) return `central:${id}`;
  let origin = voiceServerUrl;
  try {
    origin = new URL(voiceServerUrl).origin;
  } catch {
    // Keep the raw value; it is only used as a key.
  }
  return `server:${origin}:${id}`;
}
